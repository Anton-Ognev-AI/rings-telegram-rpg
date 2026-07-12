import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import { prepareAction } from "../../supabase/functions/_shared/application/prepare-action.ts";
import { resolveChoice } from "../../supabase/functions/_shared/application/resolve-choice.ts";
import { resumeRun } from "../../supabase/functions/_shared/application/resume.ts";
import { startRun } from "../../supabase/functions/_shared/application/start-run.ts";

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

  assertEquals(database.calls.map((call) => call.rpc), [
    "start_run_v1",
    "prepare_action_v1",
    "resolve_choice_v1",
    "resume_v1",
  ]);
  assertEquals(database.calls[2].args, {
    p_token_sha256: "c".repeat(64),
    p_telegram_update_id: "700000000000000001",
    p_actor_player_id: "player-1",
    p_context_sha256: "d".repeat(64),
  });
});
