import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import { abandonRun } from "../../supabase/functions/_shared/application/abandon-run.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import {
  authorizeOutboxDelivery,
  completeOutbox,
  leaseOutbox,
} from "../../supabase/functions/_shared/application/outbox.ts";
import { prepareAction } from "../../supabase/functions/_shared/application/prepare-action.ts";
import { resolveChoice } from "../../supabase/functions/_shared/application/resolve-choice.ts";
import { resumeRun } from "../../supabase/functions/_shared/application/resume.ts";
import { getRunView } from "../../supabase/functions/_shared/application/run-view.ts";
import { startRun } from "../../supabase/functions/_shared/application/start-run.ts";
import { startTelegramRun } from "../../supabase/functions/_shared/application/start-telegram-run.ts";
import { getTelegramIdentity } from "../../supabase/functions/_shared/application/telegram-identity.ts";

class RecordingDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    return Promise.resolve({ status: "ok" } as T);
  }
}

Deno.test("application commands use one narrow RPC each", async () => {
  const database = new RecordingDatabase();
  await startRun(database, {
    playerId: "player-1",
    cycleId: "2026-07-13",
    selfSnapshot: { maxHp: 40 },
    selfSnapshotSha256: "a".repeat(64),
    loadoutSnapshot: { items: [] },
    loadoutSnapshotSha256: "b".repeat(64),
  });
  await prepareAction(database, {
    playerId: "player-1",
    runId: "run-1",
    tokenSha256: "c".repeat(64),
    expectedStateVersion: 0,
    stage: 1,
    exchange: 0,
    choiceId: "s1-neutral",
    contextSha256: "d".repeat(64),
    preparedResolution: { outcome: "neutral" },
    resolutionSha256: "e".repeat(64),
    expiresAt: "2026-07-13T10:00:00.000Z",
  });
  await resolveChoice(database, {
    tokenSha256: "c".repeat(64),
    telegramUpdateId: 700000000000000001n,
    actorPlayerId: "player-1",
    contextSha256: "d".repeat(64),
  });
  await resumeRun(database, "player-1");
  await getTelegramIdentity(database, { telegramExternalId: 900000000000000001n, create: true });
  await publishFallbackDay(database, "2026-07-13T06:00:00.000Z");
  await advanceDay(database, "2026-07-13T06:00:00.000Z");
  await startTelegramRun(database, {
    playerId: "player-1",
    at: "2026-07-13T06:00:00.000Z",
    selfSnapshot: { maxHp: 40 },
    selfSnapshotSha256: "a".repeat(64),
    loadoutSnapshot: { items: [] },
    loadoutSnapshotSha256: "b".repeat(64),
  });
  await getRunView(database, { playerId: "player-1", runId: "run-1" });
  await leaseOutbox(database, {
    workerId: "worker-1",
    limit: 10,
    leaseSeconds: 30,
    at: "2026-07-13T06:00:01.000Z",
  });
  await authorizeOutboxDelivery(database, {
    outboxId: "outbox-1",
    leaseId: "lease-1",
    isNewSend: true,
    transportSeconds: 15,
    at: "2026-07-13T06:00:01.500Z",
  });
  await completeOutbox(database, {
    outboxId: "outbox-1",
    leaseId: "lease-1",
    result: "sent",
    telegramMessageId: 800000000000000001n,
    retryAt: null,
    at: "2026-07-13T06:00:02.000Z",
  });
  await abandonRun(database, { playerId: "player-1", runId: "run-1" });

  assertEquals(database.calls.map((call) => call.rpc), [
    "start_run_v1",
    "prepare_action_v1",
    "resolve_choice_v1",
    "resume_v1",
    "telegram_identity_v1",
    "publish_fallback_day_v1",
    "advance_day_v1",
    "start_run_v2",
    "run_view_v1",
    "lease_outbox_v3",
    "authorize_outbox_delivery_v2",
    "complete_outbox_v1",
    "abandon_run_v1",
  ]);
  assertEquals(database.calls[2].args, {
    p_token_sha256: "c".repeat(64),
    p_telegram_update_id: "700000000000000001",
    p_actor_player_id: "player-1",
    p_context_sha256: "d".repeat(64),
  });
  assertEquals(database.calls[4].args, {
    p_external_id: "900000000000000001",
    p_create_if_missing: true,
  });
  assertEquals(database.calls[10].args, {
    p_outbox_id: "outbox-1",
    p_lease_id: "lease-1",
    p_is_new_send: true,
    p_transport_seconds: 15,
    p_at: "2026-07-13T06:00:01.500Z",
  });
  assertEquals(database.calls[11].args, {
    p_outbox_id: "outbox-1",
    p_lease_id: "lease-1",
    p_result: "sent",
    p_telegram_message_id: "800000000000000001",
    p_retry_at: null,
    p_at: "2026-07-13T06:00:02.000Z",
  });
});
