import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { RpcResult } from "./helpers/database.ts";

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

Deno.test("100 duplicate profile callbacks produce one stat and one ledger effect", async () => {
  const fixture = await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000021::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    await sql`select game.apply_xp_delta_v1(
      ${playerId}::uuid, '2026-08-15'::date, 20, false,
      'test_grant', '94000000-0000-4000-8000-000000000021'::uuid,
      'phase4_concurrency_fixture', '00000000-0000-4000-8000-000000000001'::uuid
    )`;
    const token = "c".repeat(64);
    const context = "d".repeat(64);
    const prepared = await rpc(sql`
      select public.prepare_player_action_v1(
        ${playerId}::uuid, ${token}, 0::bigint, 7021::bigint,
        '{"kind":"buy_stat","stat":"agility"}'::jsonb,
        ${context}, clock_timestamp() + interval '1 hour'
      ) as response
    `);
    assertEquals(prepared.status, "ok");
    return { playerId, token, context };
  });

  const results = await Promise.all(
    Array.from(
      { length: 100 },
      () =>
        withDatabase((sql) =>
          rpc(sql`select public.resolve_player_action_v1(
          ${fixture.token}, 940000000000002001::bigint, ${fixture.playerId}::uuid,
          7021::bigint, ${fixture.context}
        ) as response`)
        ),
    ),
  );
  assertEquals(results.filter((result) => result.status === "applied").length, 1);
  assertEquals(results.filter((result) => result.status === "cached").length, 99);

  await withDatabase(async (sql) => {
    const [effects] = await sql<
      { agility: number; balance: number; ledger: number; profile_version: number }[]
    >`select
      ps.agility::integer,
      xa.balance::integer,
      (select count(*)::integer from game.xp_ledger
        where player_id = ${fixture.playerId}::uuid and reason = 'buy_stat_agility') as ledger,
      po.profile_version::integer
    from game.player_stats ps
    join game.xp_accounts xa using (player_id)
    join game.player_onboarding po using (player_id)
    where ps.player_id = ${fixture.playerId}::uuid`;
    assertEquals(effects, { agility: 6, balance: 0, ledger: 1, profile_version: 1 });
  });
});
