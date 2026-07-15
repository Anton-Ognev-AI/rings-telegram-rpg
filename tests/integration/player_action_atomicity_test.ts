import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { RpcResult } from "./helpers/database.ts";

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

Deno.test("a stat purchase spends exact XP and replays without a second effect", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000011::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    await sql`select game.apply_xp_delta_v1(
      ${playerId}::uuid, '2026-08-15'::date, 20, false,
      'test_grant', '94000000-0000-4000-8000-000000000011'::uuid,
      'phase4_atomicity_fixture', '00000000-0000-4000-8000-000000000001'::uuid
    )`;

    const token = "a".repeat(64);
    const context = "b".repeat(64);
    const prepared = await rpc(sql`
      select public.prepare_player_action_v1(
        ${playerId}::uuid, ${token}, 0::bigint, 7001::bigint,
        '{"kind":"buy_stat","stat":"physical"}'::jsonb,
        ${context}, clock_timestamp() + interval '1 hour'
      ) as response
    `);
    assertEquals(prepared.status, "ok");

    const applied = await rpc(sql`
      select public.resolve_player_action_v1(
        ${token}, 940000000000001001::bigint, ${playerId}::uuid, 7001::bigint, ${context}
      ) as response
    `);
    const replay = await rpc(sql`
      select public.resolve_player_action_v1(
        ${token}, 940000000000001001::bigint, ${playerId}::uuid, 7001::bigint, ${context}
      ) as response
    `);
    assertEquals(applied.status, "applied");
    assertEquals(replay.status, "cached");

    const [effects] = await sql<
      { physical: number; purchased: number; balance: number; ledger: number; processed: number }[]
    >`select
      ps.physical::integer,
      psp.physical_purchased::integer as purchased,
      xa.balance::integer,
      (select count(*)::integer from game.xp_ledger
        where player_id = ${playerId}::uuid and reason = 'buy_stat_physical') as ledger,
      (select count(*)::integer from game.processed_player_actions
        where player_id = ${playerId}::uuid) as processed
    from game.player_stats ps
    join game.player_stat_progression psp using (player_id)
    join game.xp_accounts xa using (player_id)
    where ps.player_id = ${playerId}::uuid`;
    assertEquals(effects, { physical: 6, purchased: 1, balance: 0, ledger: 1, processed: 1 });
  });
});
