import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import {
  preparePlayerAction,
  resolvePlayerAction,
} from "../../supabase/functions/_shared/application/player-action.ts";

class RecordingDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    return Promise.resolve({ status: "ok" } as T);
  }
}

Deno.test("profile actions cross the application boundary through two narrow RPCs", async () => {
  const database = new RecordingDatabase();
  await preparePlayerAction(database, {
    playerId: "player-1",
    tokenSha256: "a".repeat(64),
    profileVersion: 7,
    messageId: 700000000000000001n,
    action: { kind: "buy_stat", stat: "vitality" },
    contextSha256: "b".repeat(64),
    expiresAt: "2026-08-20T08:00:00.000Z",
  });
  await resolvePlayerAction(database, {
    tokenSha256: "a".repeat(64),
    telegramUpdateId: 900000000000000001n,
    actorPlayerId: "player-1",
    callbackMessageId: 700000000000000001n,
    contextSha256: "b".repeat(64),
  });

  assertEquals(database.calls, [
    {
      rpc: "prepare_player_action_v1",
      args: {
        p_player_id: "player-1",
        p_token_sha256: "a".repeat(64),
        p_expected_profile_version: 7,
        p_expected_message_id: "700000000000000001",
        p_action: { kind: "buy_stat", stat: "vitality" },
        p_context_sha256: "b".repeat(64),
        p_expires_at: "2026-08-20T08:00:00.000Z",
      },
    },
    {
      rpc: "resolve_player_action_v2",
      args: {
        p_token_sha256: "a".repeat(64),
        p_telegram_update_id: "900000000000000001",
        p_actor_player_id: "player-1",
        p_callback_message_id: "700000000000000001",
        p_context_sha256: "b".repeat(64),
      },
    },
  ]);
});
