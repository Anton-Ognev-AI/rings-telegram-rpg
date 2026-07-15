import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { RpcResult } from "./helpers/database.ts";

async function rpc(
  statement: PromiseLike<ReadonlyArray<unknown>>,
): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

Deno.test("identity v2 initializes canonical tutorial home exactly once", async () => {
  await withDatabase(async (sql) => {
    const externalId = 940000000000000001n;
    const created = await rpc(sql`
      select public.telegram_identity_v2(${externalId.toString()}::bigint, true) as response
    `);
    const replay = await rpc(sql`
      select public.telegram_identity_v2(${externalId.toString()}::bigint, true) as response
    `);
    assertEquals(created.status, "ok");
    assertEquals(replay.status, "ok");
    assertEquals(replay.playerId, created.playerId);

    const home = await rpc(sql`
      select public.player_home_v1(${String(created.playerId)}::uuid) as response
    `);
    assertEquals(home.status, "ok");
    assertEquals(home.tutorialCompleted, 0);
    assertEquals(home.profileVersion, 0);
    assertEquals(home.rank, "student");
    assertEquals(home.pendingOffer, null);

    const [counts] = await sql<{ onboarding: number; stats: number }[]>`
      select
        (select count(*)::integer from game.player_onboarding
          where player_id = ${String(created.playerId)}::uuid) as onboarding,
        (select count(*)::integer from game.player_stat_progression
          where player_id = ${String(created.playerId)}::uuid) as stats
    `;
    assertEquals(counts, { onboarding: 1, stats: 1 });
  });
});

Deno.test("start v3 derives the first tutorial snapshot and pins progression-v1", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000002::bigint, true) as response
    `);
    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-15T07:00:00Z'::timestamptz) as response
    `);
    await rpc(sql`
      select public.advance_day_v2('2026-08-15T07:00:00Z'::timestamptz) as response
    `);
    const started = await rpc(sql`
      select public.start_run_v3(
        ${String(identity.playerId)}::uuid,
        '2026-08-15T07:00:00Z'::timestamptz
      ) as response
    `);
    assertEquals(started.status, "applied");
    const projection = started.projection as {
      run: { id: string; maxHp: number };
      loadout: { partyMode: string; progressionConfig: string; companion: Record<string, number> };
    };
    assertEquals(projection.loadout.partyMode, "tutorial");
    assertEquals(projection.loadout.progressionConfig, "progression-v1");
    assertEquals(projection.loadout.companion, {
      maxHp: 5,
      physical: 4,
      magical: 4,
      agility: 4,
      defense: 2,
    });
    assertEquals(projection.run.maxHp, 45);

    const [assignment] = await sql<
      { tutorial_ordinal: number; guidance: string; rescue_used: boolean }[]
    >`select tutorial_ordinal, guidance, rescue_used
      from game.tutorial_run_assignments
      where run_id = ${projection.run.id}::uuid`;
    assertEquals(assignment, {
      tutorial_ordinal: 1,
      guidance: "full",
      rescue_used: false,
    });
  });
});
