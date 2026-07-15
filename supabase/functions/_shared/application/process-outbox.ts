import type { ResolutionV1, TerminalResult } from "../contracts/domain.ts";
import type { Clock } from "../infrastructure/clock.ts";
import { renderResolvedCard, renderStageCard } from "../render/stage-card.ts";
import { renderSummaryCard } from "../render/summary.ts";
import type { RenderedCard } from "../render/types.ts";
import { TelegramDeliveryError, type TelegramPort } from "../telegram/port.ts";
import { renderCanonicalProgressionCard } from "../telegram/progression-router.ts";
import type { CommandResult, DatabasePort } from "./database-port.ts";
import { authorizeOutboxDelivery, completeOutbox, leaseOutbox } from "./outbox.ts";
import { prepareRunCard, type TelegramRunView } from "./prepare-run-card.ts";
import { getPlayerHome } from "./player-home.ts";
import { getRunView } from "./run-view.ts";

const TRANSPORT_AUTHORIZATION_SECONDS = 15;
const TRANSPORT_TIMEOUT_CAP_MS = 10_000;
const TRANSPORT_DRAIN_MARGIN_MS = 1_000;

export interface ProcessOutboxDependencies {
  readonly database: DatabasePort;
  readonly telegram: TelegramPort;
  readonly clock: Clock;
  readonly callbackKey: Uint8Array;
}

export interface ProcessOutboxInput {
  readonly workerId: string;
  readonly limit: number;
  readonly leaseSeconds: number;
}

export interface ProcessOutboxResult {
  readonly leased: number;
  readonly sent: number;
  readonly retried: number;
  readonly dead: number;
  readonly deliveryUnknown: number;
  readonly superseded: number;
}

interface LeasedOutboxMessage {
  readonly id: string;
  readonly leaseId: string;
  readonly intentType: string;
  readonly payload: { readonly runId: string; readonly stateVersion: number };
  readonly attempts: number;
  readonly playerId: string;
  readonly cardMessageId: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(value: unknown): LeasedOutboxMessage {
  if (!isRecord(value) || !isRecord(value.payload)) throw new Error("invalid_outbox_message");
  const fields = ["id", "leaseId", "intentType", "playerId"] as const;
  if (fields.some((field) => typeof value[field] !== "string")) {
    throw new Error("invalid_outbox_message");
  }
  const cardMessageId = value.cardMessageId;
  const attempts = value.attempts;
  const runId = value.payload.runId;
  const stateVersion = value.payload.stateVersion;
  if (
    (cardMessageId !== null && typeof cardMessageId !== "string") ||
    typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts < 1 ||
    typeof runId !== "string" || typeof stateVersion !== "number" ||
    !Number.isSafeInteger(stateVersion) || stateVersion < 0
  ) throw new Error("invalid_outbox_message");
  return {
    id: value.id as string,
    leaseId: value.leaseId as string,
    intentType: value.intentType as string,
    payload: { runId, stateVersion },
    attempts,
    playerId: value.playerId as string,
    cardMessageId,
  };
}

interface DeliveryAuthorization {
  readonly telegramExternalId: string;
  readonly deliveryDeadline: string;
}

function parseDeliveryAuthorization(
  value: unknown,
): DeliveryAuthorization | "superseded" | "retry" {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("invalid_delivery_authorization");
  }
  if (value.status === "superseded") return "superseded";
  if (value.status === "rejected") return "retry";
  if (
    value.status !== "ok" || typeof value.telegramExternalId !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.telegramExternalId) ||
    typeof value.deliveryDeadline !== "string" ||
    !Number.isFinite(Date.parse(value.deliveryDeadline))
  ) throw new Error("invalid_delivery_authorization");
  return {
    telegramExternalId: value.telegramExternalId,
    deliveryDeadline: value.deliveryDeadline,
  };
}

function parsePositiveBigInt(value: string, code: string): bigint {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(code);
  return BigInt(value);
}

function asRunView(value: CommandResult): TelegramRunView {
  if (
    value.status !== "ok" || !isRecord(value.run) || !isRecord(value.content) ||
    !Array.isArray(value.content.stages)
  ) {
    throw new Error("invalid_run_view");
  }
  return value as unknown as TelegramRunView;
}

function terminalResult(view: TelegramRunView, resolution: ResolutionV1): TerminalResult {
  if (resolution.terminal) return resolution.terminal;
  if (view.run.status === "finished_victory") return "victory";
  if (view.run.status === "finished_contained") return "contained";
  return "defeated";
}

async function renderCanonicalCard(
  dependencies: ProcessOutboxDependencies,
  view: TelegramRunView,
): Promise<RenderedCard> {
  const lastResolution = view.lastResolution as ResolutionV1 | null;
  if (view.run.status === "active") {
    const prepared = await prepareRunCard(dependencies.database, view, dependencies.callbackKey);
    return lastResolution
      ? renderResolvedCard({ resolution: lastResolution, next: prepared, content: view.content })
      : renderStageCard(prepared);
  }
  if (view.tutorial) {
    const progressionCard = await renderCanonicalProgressionCard(dependencies, {
      home: await getPlayerHome(dependencies.database, view.run.playerId),
      view,
    });
    if (progressionCard !== null) return progressionCard;
  }
  if (!lastResolution) throw new Error("terminal_run_without_resolution");
  const strongest = lastResolution.outcome === "success" && lastResolution.check
    ? {
      stat: lastResolution.check.stat,
      totalPower: lastResolution.check.totalPower,
      threshold: lastResolution.check.threshold,
    }
    : undefined;
  return renderSummaryCard({
    terminal: terminalResult(view, lastResolution),
    deepestStage: lastResolution.stage,
    hp: view.run.hp,
    maxHp: view.run.maxHp,
    xp: view.run.xpEarned,
    strongestSuccessfulCheck: strongest,
    lastResolution,
    content: view.content,
  });
}

function retryDelaySeconds(attempts: number, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested)) {
    return Math.max(1, Math.min(900, Math.ceil(requested)));
  }
  return Math.min(300, 2 ** Math.min(8, attempts));
}

function assertCompleted(result: CommandResult): CommandResult {
  if (result.status !== "applied" && result.status !== "cached") {
    throw new Error("outbox_completion_rejected");
  }
  return result;
}

export async function processOutboxBatch(
  dependencies: ProcessOutboxDependencies,
  input: ProcessOutboxInput,
): Promise<ProcessOutboxResult> {
  const now = dependencies.clock.now();
  const leased = await leaseOutbox(dependencies.database, {
    ...input,
    at: now.toISOString(),
  });
  if (leased.status !== "ok" || !Array.isArray(leased.messages)) {
    throw new Error("outbox_lease_rejected");
  }
  const result = {
    leased: leased.messages.length,
    sent: 0,
    retried: 0,
    dead: 0,
    deliveryUnknown: 0,
    superseded: 0,
  };

  for (const raw of leased.messages) {
    const message = parseMessage(raw);
    const completionBase = {
      outboxId: message.id,
      leaseId: message.leaseId,
      at: dependencies.clock.now().toISOString(),
    };
    const normalRender = message.intentType === "render_run_state";
    const repairRender = message.intentType === "repair_run_state";
    if (!normalRender && !repairRender) {
      assertCompleted(
        await completeOutbox(dependencies.database, {
          ...completionBase,
          result: "dead",
          telegramMessageId: null,
          retryAt: null,
        }),
      );
      result.dead += 1;
      continue;
    }

    const runViewResult = await getRunView(dependencies.database, {
      playerId: message.playerId,
      runId: message.payload.runId,
    });
    if (runViewResult.status === "rejected" && runViewResult.reason === "inactive_player") {
      assertCompleted(
        await completeOutbox(dependencies.database, {
          ...completionBase,
          result: "superseded",
          telegramMessageId: null,
          retryAt: null,
        }),
      );
      result.superseded += 1;
      continue;
    }
    const view = asRunView(runViewResult);
    if (
      repairRender &&
      (message.cardMessageId === null || view.card === null ||
        view.card.messageId !== message.cardMessageId)
    ) {
      assertCompleted(
        await completeOutbox(dependencies.database, {
          ...completionBase,
          result: "dead",
          telegramMessageId: null,
          retryAt: null,
        }),
      );
      result.dead += 1;
      continue;
    }
    if (
      view.run.stateVersion > message.payload.stateVersion ||
      (normalRender &&
        (view.card?.lastStateVersion ?? -1) >= message.payload.stateVersion)
    ) {
      assertCompleted(
        await completeOutbox(dependencies.database, {
          ...completionBase,
          result: "superseded",
          telegramMessageId: null,
          retryAt: null,
        }),
      );
      result.superseded += 1;
      continue;
    }
    if (view.run.stateVersion !== message.payload.stateVersion) {
      throw new Error("outbox_state_ahead_of_view");
    }

    const card = await renderCanonicalCard(dependencies, view);
    const existingMessageId = message.cardMessageId === null
      ? null
      : parsePositiveBigInt(message.cardMessageId, "invalid_card_message_id");
    const authorization = parseDeliveryAuthorization(
      await authorizeOutboxDelivery(dependencies.database, {
        outboxId: message.id,
        leaseId: message.leaseId,
        isNewSend: existingMessageId === null,
        transportSeconds: TRANSPORT_AUTHORIZATION_SECONDS,
        at: dependencies.clock.now().toISOString(),
      }),
    );
    if (authorization === "superseded") {
      result.superseded += 1;
      continue;
    }
    const remainingTransportMs = authorization === "retry"
      ? 0
      : Date.parse(authorization.deliveryDeadline) - dependencies.clock.now().getTime() -
        TRANSPORT_DRAIN_MARGIN_MS;
    if (authorization === "retry" || remainingTransportMs <= 0) {
      result.retried += 1;
      continue;
    }
    const timeoutMs = Math.min(TRANSPORT_TIMEOUT_CAP_MS, Math.floor(remainingTransportMs));
    try {
      const delivered = existingMessageId === null
        ? await dependencies.telegram.sendMessage({
          chatId: authorization.telegramExternalId,
          text: card.text,
          buttons: card.buttons,
          parseMode: "HTML",
          timeoutMs,
        })
        : await dependencies.telegram.editMessage({
          chatId: authorization.telegramExternalId,
          messageId: existingMessageId,
          text: card.text,
          buttons: card.buttons,
          parseMode: "HTML",
          timeoutMs,
        });
      assertCompleted(
        await completeOutbox(dependencies.database, {
          ...completionBase,
          result: "sent",
          telegramMessageId: delivered.messageId,
          retryAt: null,
        }),
      );
      result.sent += 1;
    } catch (error) {
      if (!(error instanceof TelegramDeliveryError)) throw error;
      const unknownNewSend = error.kind === "delivery_unknown" && existingMessageId === null;
      const permanent = error.kind === "permanent";
      const completionResult = unknownNewSend
        ? "delivery_unknown" as const
        : permanent
        ? "dead" as const
        : "retry" as const;
      const retryAt = completionResult === "retry"
        ? new Date(
          dependencies.clock.now().getTime() +
            retryDelaySeconds(message.attempts, error.retryAfterSeconds) * 1000,
        ).toISOString()
        : null;
      const completed = assertCompleted(
        await completeOutbox(dependencies.database, {
          ...completionBase,
          result: completionResult,
          telegramMessageId: null,
          retryAt,
        }),
      );
      if (completionResult === "retry" && completed.outboxStatus === "dead") result.dead += 1;
      else if (completionResult === "retry") result.retried += 1;
      else if (completionResult === "dead") result.dead += 1;
      else result.deliveryUnknown += 1;
    }
  }
  return result;
}
