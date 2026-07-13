import type { Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "./db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../supabase/functions/_shared/application/day-cycle.ts";
import { processOutboxBatch } from "../supabase/functions/_shared/application/process-outbox.ts";
import { startTelegramRun } from "../supabase/functions/_shared/application/start-telegram-run.ts";
import { getTelegramIdentity } from "../supabase/functions/_shared/application/telegram-identity.ts";
import { canonicalJson, sha256Hex } from "../supabase/functions/_shared/domain/canonical-json.ts";
import { FixedClock } from "../supabase/functions/_shared/infrastructure/clock.ts";
import { RecordingTelegramPort } from "../supabase/functions/_shared/telegram/fake.ts";
import {
  handleTelegramUpdate,
  type TelegramHandlerDependencies,
} from "../supabase/functions/_shared/telegram/handler.ts";
import type {
  TelegramCallbackAnswerInput,
  TelegramEditInput,
  TelegramMessageInput,
  TelegramPort,
} from "../supabase/functions/_shared/telegram/port.ts";
import type { NormalizedCallbackUpdate } from "../supabase/functions/_shared/telegram/update.ts";
import { PostgresRpcDatabase } from "../tests/e2e/helpers/postgres-rpc.ts";
import { CALLBACK_KEY } from "../tests/e2e/helpers/telegram-flow.ts";

const CALLBACK_COUNT = 6000;
const RUN_COUNT = 60;
const CALLBACKS_PER_RUN = CALLBACK_COUNT / RUN_COUNT;
const CALLBACKS_PER_BATCH = 10;
const MINIMUM_EFFECTIVE_RATE_PER_SECOND = 10;
const opensAt = "2027-01-15T07:00:00.000Z";
const externalIdBase = 997000000000000000n;
const snapshot = {
  maxHp: 100,
  physical: 70,
  magical: 70,
  agility: 70,
  vitality: 70,
  defense: 0,
  vampRateBps: 0,
  postHeal: 0,
};
const loadout = { partyMode: "solo", companion: null, items: [], rings: [] };

export interface LoadGateInput {
  readonly callbackCount: number;
  readonly canonicalRunCount: number;
  readonly acknowledgementP95Ms: number;
  readonly effectiveThroughputPerSecond: number;
  readonly errorCount: number;
  readonly duplicateEffects: number;
  readonly lostCanonicalOutcomes: number;
  readonly maximumOutboxBacklog: number;
  readonly finalOutboxBacklog: number;
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0 || !Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new Error("invalid_percentile_input");
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(quantile * ordered.length) - 1]!;
}

export function loadGatePasses(input: LoadGateInput): boolean {
  return input.callbackCount === CALLBACK_COUNT && input.canonicalRunCount === RUN_COUNT &&
    input.acknowledgementP95Ms < 2000 &&
    input.effectiveThroughputPerSecond >= MINIMUM_EFFECTIVE_RATE_PER_SECOND &&
    input.errorCount === 0 && input.duplicateEffects === 0 &&
    input.lostCanonicalOutcomes === 0 && input.maximumOutboxBacklog <= CALLBACKS_PER_BATCH &&
    input.finalOutboxBacklog === 0;
}

class AcknowledgementPort implements TelegramPort {
  constructor(
    private readonly startedAt: number,
    private readonly record: (latencyMs: number) => void,
  ) {}

  answerCallback(_input: TelegramCallbackAnswerInput): Promise<void> {
    this.record(performance.now() - this.startedAt);
    return Promise.resolve();
  }

  sendMessage(_input: TelegramMessageInput): Promise<{ readonly messageId: bigint }> {
    return Promise.reject(new Error("unexpected_load_send"));
  }

  editMessage(_input: TelegramEditInput): Promise<{ readonly messageId: bigint }> {
    return Promise.reject(new Error("unexpected_load_edit"));
  }
}

async function outboxBacklog(sql: Sql, runIds: readonly string[]): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::integer as count
    from game.outbox_messages
    where payload->>'runId' = any(${runIds}::text[]) and status in ('pending', 'leased')`;
  return row?.count ?? -1;
}

async function main(): Promise<void> {
  const report = await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    await publishFallbackDay(database, opensAt);
    await advanceDay(database, opensAt);
    const selfSnapshotSha256 = await sha256Hex(canonicalJson(snapshot));
    const loadoutSnapshotSha256 = await sha256Hex(canonicalJson(loadout));
    const lanes: Array<{ externalId: bigint; runId: string }> = [];
    for (let lane = 0; lane < RUN_COUNT; lane += 1) {
      const externalId = externalIdBase + BigInt(lane + 1);
      const identity = await getTelegramIdentity(database, {
        telegramExternalId: externalId,
        create: true,
      });
      const started = await startTelegramRun(database, {
        playerId: String(identity.playerId),
        at: opensAt,
        selfSnapshot: snapshot,
        selfSnapshotSha256,
        loadoutSnapshot: loadout,
        loadoutSnapshotSha256,
      });
      if (started.status !== "applied") throw new Error("load_setup_start_rejected");
      lanes.push({
        externalId,
        runId: String((started.projection as { run: { id: string } }).run.id),
      });
    }
    const runIds = lanes.map((lane) => lane.runId);

    const loadTelegram = new RecordingTelegramPort();
    let initialCardsSent = 0;
    while (initialCardsSent < RUN_COUNT) {
      const delivered = await processOutboxBatch({
        database,
        telegram: loadTelegram,
        clock: new FixedClock(opensAt),
        callbackKey: CALLBACK_KEY,
      }, {
        workerId: "50000000-0000-4000-8000-000000000600",
        limit: 50,
        leaseSeconds: 30,
      });
      initialCardsSent += delivered.sent;
      if (delivered.leased === 0) break;
    }
    if (initialCardsSent !== RUN_COUNT) throw new Error("load_setup_cards_not_sent");
    const sentCalls = loadTelegram.calls.filter((call) => call.operation === "sendMessage");
    if (sentCalls.length !== RUN_COUNT) throw new Error("load_setup_cards_missing");
    const cardByExternalId = new Map<
      string,
      { callbackData: string; messageId: bigint }
    >();
    sentCalls.forEach((sent, index) => {
      if (sent.operation !== "sendMessage") return;
      const callbackData = sent.input.buttons?.flat()[0]?.callbackData;
      if (!callbackData) throw new Error("load_setup_callback_missing");
      cardByExternalId.set(sent.input.chatId.toString(), {
        callbackData,
        messageId: 810000000n + BigInt(index),
      });
    });

    const outboxDependencies = {
      database,
      telegram: loadTelegram,
      clock: new FixedClock(opensAt),
      callbackKey: CALLBACK_KEY,
    } as const;

    const dependenciesBase = {
      database,
      clock: new FixedClock(opensAt),
      callbackKey: CALLBACK_KEY,
      deletionSink: {
        recordTombstone: () => Promise.reject(new Error("deletion_not_used_by_load")),
      },
    } satisfies Omit<TelegramHandlerDependencies, "telegram">;
    const acknowledgements: number[] = [];
    const routes = new Map<string, number>();
    let errorCount = 0;
    let maximumOutboxBacklog = 0;
    const wallStartedAt = performance.now();

    for (let batchStart = 0; batchStart < CALLBACK_COUNT; batchStart += CALLBACKS_PER_BATCH) {
      const batch = Array.from({ length: CALLBACKS_PER_BATCH }, (_, offset) => {
        const index = batchStart + offset;
        const lane = lanes[index % RUN_COUNT]!;
        const card = cardByExternalId.get(lane.externalId.toString());
        if (!card) throw new Error("load_setup_lane_card_missing");
        const update: NormalizedCallbackUpdate = {
          kind: "callback",
          updateId: 998000000000000000n + BigInt(index),
          telegramExternalId: lane.externalId,
          chatId: lane.externalId,
          messageId: card.messageId,
          callbackQueryId: `load-${index}`,
          data: card.callbackData,
        };
        const invocationStartedAt = performance.now();
        const port = new AcknowledgementPort(
          invocationStartedAt,
          (latency) => acknowledgements.push(latency),
        );
        return handleTelegramUpdate({ ...dependenciesBase, telegram: port }, update)
          .then((result) => {
            routes.set(result.route, (routes.get(result.route) ?? 0) + 1);
          })
          .catch(() => {
            errorCount += 1;
          });
      });
      await Promise.all(batch);
      maximumOutboxBacklog = Math.max(
        maximumOutboxBacklog,
        await outboxBacklog(sql, runIds),
      );
      const drained = await processOutboxBatch(outboxDependencies, {
        workerId: "50000000-0000-4000-8000-000000000601",
        limit: CALLBACKS_PER_BATCH,
        leaseSeconds: 30,
      });
      errorCount += drained.retried + drained.dead + drained.deliveryUnknown;
    }

    const [effects] = await sql<{
      canonical_run_count: number;
      duplicate_effects: number;
    }[]>`with target_runs as (
        select unnest(${runIds}::uuid[]) as run_id
      ), stage_effects as (
        select run_id, count(*)::integer as effect_count
        from game.run_stage_results where run_id = any(${runIds}::uuid[]) group by run_id
      ), processed_effects as (
        select t.run_id, count(*)::integer as effect_count
        from game.processed_actions pa
        join game.action_tokens t on t.token_sha256 = pa.token_sha256
        where t.run_id = any(${runIds}::uuid[]) group by t.run_id
      ), outcome_effects as (
        select (payload->>'runId')::uuid as run_id, count(*)::integer as effect_count
        from game.outbox_messages
        where payload->>'runId' = any(${runIds}::text[])
          and payload->>'stateVersion' = '1' and intent_type = 'render_run_state'
          and status = 'sent'
        group by payload->>'runId'
      ) select
        count(*) filter (where r.state_version = 1
          and coalesce(s.effect_count, 0) = 1
          and coalesce(p.effect_count, 0) = 1
          and coalesce(o.effect_count, 0) = 1
          and c.last_state_version = 1)::integer as canonical_run_count,
        coalesce(sum(greatest(coalesce(s.effect_count, 0) - 1, 0)
          + greatest(coalesce(p.effect_count, 0) - 1, 0)
          + greatest(coalesce(o.effect_count, 0) - 1, 0)), 0)::integer as duplicate_effects
      from target_runs t
      join game.runs r on r.id = t.run_id
      left join stage_effects s on s.run_id = t.run_id
      left join processed_effects p on p.run_id = t.run_id
      left join outcome_effects o on o.run_id = t.run_id
      left join game.telegram_run_cards c on c.run_id = t.run_id`;
    if (!effects) throw new Error("load_effects_missing");
    const applied = routes.get("choice_applied") ?? 0;
    const cached = routes.get("choice_cached") ?? 0;
    const otherRoutes = [...routes.entries()]
      .filter(([route]) => route !== "choice_applied" && route !== "choice_cached")
      .reduce((total, [, count]) => total + count, 0);
    const duplicateEffects = effects.duplicate_effects;
    const lostCanonicalOutcomes = RUN_COUNT - effects.canonical_run_count +
      Math.abs(applied - RUN_COUNT) +
      Math.abs(cached - (CALLBACK_COUNT - RUN_COUNT)) + otherRoutes;
    const finalOutboxBacklog = await outboxBacklog(sql, runIds);
    const wallDurationMs = performance.now() - wallStartedAt;
    const effectiveThroughputPerSecond = CALLBACK_COUNT / (wallDurationMs / 1000);
    const acknowledgementP50Ms = percentile(acknowledgements, 0.5);
    const acknowledgementP95Ms = percentile(acknowledgements, 0.95);
    const acknowledgementP99Ms = percentile(acknowledgements, 0.99);
    const gateInput: LoadGateInput = {
      callbackCount: CALLBACK_COUNT,
      canonicalRunCount: effects.canonical_run_count,
      acknowledgementP95Ms,
      effectiveThroughputPerSecond,
      errorCount: errorCount + Number(acknowledgements.length !== CALLBACK_COUNT),
      duplicateEffects,
      lostCanonicalOutcomes,
      maximumOutboxBacklog,
      finalOutboxBacklog,
    };
    return {
      ...gateInput,
      runCount: RUN_COUNT,
      callbacksPerRun: CALLBACKS_PER_RUN,
      minimumEffectiveRatePerSecond: MINIMUM_EFFECTIVE_RATE_PER_SECOND,
      targetWorkloadSeconds: CALLBACK_COUNT / MINIMUM_EFFECTIVE_RATE_PER_SECOND,
      acknowledgementP50Ms,
      acknowledgementP99Ms,
      acknowledgementMaximumMs: Math.max(...acknowledgements),
      appliedCallbacks: applied,
      cachedCallbacks: cached,
      otherRoutes,
      externalTelegramCalls: 0,
      syntheticTelegramCalls: loadTelegram.calls.filter((call) =>
        call.operation === "sendMessage" || call.operation === "editMessage"
      ).length,
      wallDurationMs,
      verdict: loadGatePasses(gateInput) ? "PASS" : "FAIL",
    };
  });

  console.log(JSON.stringify(report));
  if (report.verdict !== "PASS") throw new Error("callback_load_gate_failed");
}

if (import.meta.main) await main();
