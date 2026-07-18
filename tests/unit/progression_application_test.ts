import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import { getPlayerHome } from "../../supabase/functions/_shared/application/player-home.ts";
import { requestProfileRunRender } from "../../supabase/functions/_shared/application/request-run-render.ts";
import { startOnboardingRun } from "../../supabase/functions/_shared/application/start-onboarding-run.ts";
import { getTelegramIdentityV2 } from "../../supabase/functions/_shared/application/telegram-identity-v2.ts";

class RecordingDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    return Promise.resolve({ status: "ok" } as T);
  }
}

Deno.test("Phase 4A application adapters use server-authoritative narrow RPCs", async () => {
  const database = new RecordingDatabase();
  await getTelegramIdentityV2(database, {
    telegramExternalId: 940000000000000001n,
    create: true,
  });
  await getPlayerHome(database, "player-1");
  await startOnboardingRun(database, {
    playerId: "player-1",
    at: "2026-08-15T07:00:00.000Z",
  });
  await requestProfileRunRender(database, {
    playerId: "player-1",
    runId: "run-1",
    profileVersion: 2,
  });

  assertEquals(database.calls, [
    {
      rpc: "telegram_identity_v2",
      args: { p_external_id: "940000000000000001", p_create_if_missing: true },
    },
    { rpc: "player_home_v1", args: { p_player_id: "player-1" } },
    {
      rpc: "start_run_v3",
      args: { p_player_id: "player-1", p_at: "2026-08-15T07:00:00.000Z" },
    },
    {
      rpc: "request_profile_run_render_v1",
      args: { p_player_id: "player-1", p_run_id: "run-1", p_profile_version: 2 },
    },
  ]);
});
