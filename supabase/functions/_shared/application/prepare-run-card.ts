import type { DungeonContentV1, StageV1 } from "../contracts/content.ts";
import type {
  CompanionSnapshot,
  PartySnapshot,
  ResolutionV1,
  RunStateV1,
  SelfSnapshot,
  TerminalResult,
} from "../contracts/domain.ts";
import { resolveAndHash } from "../domain/resolver-registry.ts";
import { deriveCallbackToken, type DerivedCallbackToken } from "../telegram/callback-token.ts";
import type { CommandResult, DatabasePort } from "./database-port.ts";
import { prepareAction } from "./prepare-action.ts";

export interface TelegramRunView {
  readonly status: "ok";
  readonly run: {
    readonly id: string;
    readonly playerId: string;
    readonly cycleId: string;
    readonly status: string;
    readonly phase: string;
    readonly stateVersion: number;
    readonly stage: number;
    readonly exchange: 1 | 2 | null;
    readonly hp: number;
    readonly maxHp: number;
    readonly bossHp: number | null;
    readonly xpEarned: number;
    readonly vampHealedStage?: number;
    readonly vampHealedRun?: number;
  };
  readonly selfSnapshot: Readonly<Record<string, unknown>>;
  readonly loadout: Readonly<Record<string, unknown>>;
  readonly content: DungeonContentV1;
  readonly cycle: {
    readonly cycleId: string;
    readonly opensAt: string;
    readonly closesAt: string;
    readonly graceEndsAt: string;
    readonly status: string;
  };
  readonly lastResolution: Readonly<Record<string, unknown>> | null;
  readonly card: {
    readonly messageId: string;
    readonly lastStateVersion: number;
  } | null;
}

export interface PreparedCardChoice extends DerivedCallbackToken {
  readonly choiceId: string;
  readonly label: string;
  readonly callbackData: string;
  readonly resolution: ResolutionV1;
  readonly resolutionSha256: string;
}

export interface PreparedRunCard {
  readonly view: TelegramRunView;
  readonly stage: StageV1;
  readonly party: PartySnapshot;
  readonly state: RunStateV1;
  readonly choices: readonly PreparedCardChoice[];
}

function finiteInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("invalid_run_view");
  }
  return value;
}

function selfSnapshot(value: Readonly<Record<string, unknown>>): SelfSnapshot {
  const result = {
    maxHp: finiteInteger(value, "maxHp"),
    physical: finiteInteger(value, "physical"),
    magical: finiteInteger(value, "magical"),
    agility: finiteInteger(value, "agility"),
    vitality: finiteInteger(value, "vitality"),
    defense: finiteInteger(value, "defense"),
    vampRateBps: finiteInteger(value, "vampRateBps"),
    postHeal: finiteInteger(value, "postHeal"),
  };
  if (result.maxHp === 0) throw new Error("invalid_run_view");
  return result;
}

function companionSnapshot(value: Readonly<Record<string, unknown>>): CompanionSnapshot {
  const result = {
    maxHp: finiteInteger(value, "maxHp"),
    physical: finiteInteger(value, "physical"),
    magical: finiteInteger(value, "magical"),
    agility: finiteInteger(value, "agility"),
    defense: finiteInteger(value, "defense"),
  };
  if (result.maxHp === 0) throw new Error("invalid_run_view");
  return result;
}

function partySnapshot(view: TelegramRunView): PartySnapshot {
  const self = selfSnapshot(view.selfSnapshot);
  const mode = view.loadout.partyMode ?? "solo";
  if (mode === "solo") return { mode, self, companion: null };
  if (mode !== "tutorial" && mode !== "partner") throw new Error("invalid_run_view");
  const companion = view.loadout.companion;
  if (typeof companion !== "object" || companion === null || Array.isArray(companion)) {
    throw new Error("invalid_run_view");
  }
  return {
    mode,
    self,
    companion: companionSnapshot(companion as Readonly<Record<string, unknown>>),
  };
}

function terminalResult(view: TelegramRunView): TerminalResult | null {
  if (view.run.status === "active") return null;
  const terminal = view.lastResolution?.terminal;
  return terminal === "victory" || terminal === "contained" || terminal === "defeated"
    ? terminal
    : "defeated";
}

function runState(view: TelegramRunView): RunStateV1 {
  const firstBossExchange = view.run.stage === 10 && view.run.exchange === 1;
  return {
    stage: view.run.stage,
    exchange: firstBossExchange ? null : view.run.exchange,
    hp: view.run.hp,
    bossHp: firstBossExchange ? null : view.run.bossHp,
    xp: view.run.xpEarned,
    vampHealedStage: view.run.vampHealedStage ?? 0,
    vampHealedRun: view.run.vampHealedRun ?? 0,
    terminal: terminalResult(view),
  };
}

function currentStage(view: TelegramRunView): StageV1 {
  const stage = view.content.stages[view.run.stage - 1];
  if (!stage || stage.number !== view.run.stage) throw new Error("invalid_run_view");
  return stage;
}

function visibleChoices(view: TelegramRunView, stage: StageV1) {
  if (view.run.stage !== 10) return stage.choices ?? [];
  const exchange = view.run.exchange;
  if (exchange !== 1 && exchange !== 2) throw new Error("invalid_run_view");
  return stage.bossExchanges?.[exchange - 1]?.choices ?? [];
}

export async function prepareRunCard(
  database: DatabasePort,
  view: TelegramRunView,
  callbackKey: Uint8Array,
): Promise<PreparedRunCard> {
  const party = partySnapshot(view);
  const state = runState(view);
  const stage = currentStage(view);
  if (view.run.status !== "active") return { view, stage, party, state, choices: [] };

  const choices: PreparedCardChoice[] = [];
  for (const choice of visibleChoices(view, stage)) {
    const exchange = view.run.stage === 10 ? view.run.exchange : null;
    const command = {
      resolverVersion: "v1" as const,
      stage: view.run.stage,
      exchange,
      choiceId: choice.id,
    };
    const replay = await resolveAndHash({ content: view.content, party, state, command });
    const token = await deriveCallbackToken(callbackKey, {
      playerId: view.run.playerId,
      runId: view.run.id,
      stateVersion: view.run.stateVersion,
      stage: view.run.stage,
      exchange,
      choiceId: choice.id,
    });
    const result = await prepareAction(database, {
      playerId: view.run.playerId,
      runId: view.run.id,
      tokenSha256: token.tokenSha256,
      expectedStateVersion: view.run.stateVersion,
      stage: view.run.stage,
      exchange: exchange ?? 0,
      choiceId: choice.id,
      contextSha256: token.contextSha256,
      preparedResolution: replay.resolution as unknown as Readonly<Record<string, unknown>>,
      resolutionSha256: replay.hash,
      expiresAt: view.cycle.graceEndsAt,
    });
    if (!["ok", "cached"].includes((result as CommandResult).status)) {
      throw new Error("prepare_action_rejected");
    }
    choices.push({
      ...token,
      choiceId: choice.id,
      label: choice.label,
      callbackData: token.raw,
      resolution: replay.resolution,
      resolutionSha256: replay.hash,
    });
  }
  return { view, stage, party, state, choices };
}
