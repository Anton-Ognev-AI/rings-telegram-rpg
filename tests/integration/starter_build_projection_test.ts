import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { SelfSnapshot } from "../../supabase/functions/_shared/contracts/domain.ts";
import type { RpcResult } from "./helpers/database.ts";

type Sql = Parameters<Parameters<typeof withDatabase>[0]>[0];

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

type Stat = "physical" | "magical" | "agility" | "vitality";
type Ring = "weapon" | "fire" | "defense" | "healing";
type MainItem = "training_sword" | "apprentice_focus";
type SupportItem = "training_armor" | "student_talisman";

interface BuildCase {
  readonly externalId: bigint;
  readonly stat: Stat;
  readonly purchased: number;
  readonly ring: Ring;
  readonly main: MainItem;
  readonly support: SupportItem;
  readonly expected: SelfSnapshot;
  readonly ringBreakdownStat: keyof Pick<
    SelfSnapshot,
    "physical" | "magical" | "defense" | "postHeal"
  >;
  readonly ringAmount: number;
}

const buildCases: readonly BuildCase[] = [
  {
    externalId: 940000000000000031n,
    stat: "physical",
    purchased: 1,
    ring: "weapon",
    main: "training_sword",
    support: "training_armor",
    expected: {
      maxHp: 40,
      physical: 9,
      magical: 5,
      agility: 5,
      vitality: 5,
      defense: 7,
      vampRateBps: 0,
      postHeal: 0,
    },
    ringBreakdownStat: "physical",
    ringAmount: 1,
  },
  {
    externalId: 940000000000000032n,
    stat: "magical",
    purchased: 1,
    ring: "fire",
    main: "apprentice_focus",
    support: "student_talisman",
    expected: {
      maxHp: 44,
      physical: 5,
      magical: 9,
      agility: 5,
      vitality: 5,
      defense: 5,
      vampRateBps: 0,
      postHeal: 0,
    },
    ringBreakdownStat: "magical",
    ringAmount: 1,
  },
  {
    externalId: 940000000000000033n,
    stat: "agility",
    purchased: 1,
    ring: "defense",
    main: "training_sword",
    support: "training_armor",
    expected: {
      maxHp: 40,
      physical: 7,
      magical: 5,
      agility: 6,
      vitality: 5,
      defense: 8,
      vampRateBps: 0,
      postHeal: 0,
    },
    ringBreakdownStat: "defense",
    ringAmount: 1,
  },
  {
    externalId: 940000000000000034n,
    stat: "vitality",
    purchased: 3,
    ring: "healing",
    main: "apprentice_focus",
    support: "student_talisman",
    expected: {
      maxHp: 56,
      physical: 5,
      magical: 7,
      agility: 5,
      vitality: 8,
      defense: 6,
      vampRateBps: 0,
      postHeal: 1,
    },
    ringBreakdownStat: "postHeal",
    ringAmount: 1,
  },
];

function itemBonus(item: MainItem | SupportItem): Readonly<Record<string, number>> {
  switch (item) {
    case "training_sword":
      return { physical: 2 };
    case "apprentice_focus":
      return { magical: 2 };
    case "training_armor":
      return { defense: 2 };
    case "student_talisman":
      return { maxHp: 4 };
  }
}

async function seedCompletedBuild(sql: Sql, fixture: BuildCase): Promise<string> {
  const identity = await rpc(sql`
    select public.telegram_identity_v2(${fixture.externalId.toString()}::bigint, true) as response
  `);
  const playerId = String(identity.playerId);
  await sql`update game.player_onboarding set
    tutorial_completed = 2,
    academy_rank = 'novice',
    first_purchased_stat = ${fixture.stat},
    first_stat_purchase_at = clock_timestamp(),
    initial_training_resolved_at = clock_timestamp()
    where player_id = ${playerId}::uuid`;
  if (fixture.stat === "physical") {
    await sql`update game.player_stats set physical = physical + ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
    await sql`update game.player_stat_progression set physical_purchased = ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
  } else if (fixture.stat === "magical") {
    await sql`update game.player_stats set magical = magical + ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
    await sql`update game.player_stat_progression set magical_purchased = ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
  } else if (fixture.stat === "agility") {
    await sql`update game.player_stats set agility = agility + ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
    await sql`update game.player_stat_progression set agility_purchased = ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
  } else {
    await sql`update game.player_stats set
      vitality = vitality + ${fixture.purchased},
      max_hp = max_hp + ${fixture.purchased * 4},
      defense = defense + ${Math.floor(fixture.purchased / 3)}
      where player_id = ${playerId}::uuid`;
    await sql`update game.player_stat_progression set vitality_purchased = ${fixture.purchased}
      where player_id = ${playerId}::uuid`;
  }
  await sql`insert into game.player_equipment(player_id, slot, item_key, bonuses) values
    (${playerId}::uuid, 'main', ${fixture.main}, ${sql.json(itemBonus(fixture.main))}::jsonb),
    (${playerId}::uuid, ${fixture.support === "training_armor" ? "armor" : "talisman"},
      ${fixture.support}, ${sql.json(itemBonus(fixture.support))}::jsonb)`;
  await sql`insert into game.player_rings(player_id, ring_kind, progression_config_id)
    values (
      ${playerId}::uuid, ${fixture.ring},
      '00000000-0000-4000-8000-000000000002'::uuid
    )`;
  return playerId;
}

Deno.test("home and run start expose one canonical four-ring starter-build projection", async () => {
  await withDatabase(async (sql) => {
    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-26T07:00:00Z'::timestamptz) as response
    `);
    for (const fixture of buildCases) {
      const playerId = await seedCompletedBuild(sql, fixture);
      const home = await rpc(sql`select public.player_home_v1(${playerId}::uuid) as response`);
      assertEquals(home.status, "ok");
      const homeBuild = home.build as {
        selfSnapshot: SelfSnapshot;
        loadoutSnapshot: {
          items: readonly unknown[];
          rings: readonly unknown[];
        };
        breakdown: Record<string, Array<Record<string, unknown>>>;
      };
      assertEquals(homeBuild.selfSnapshot, fixture.expected);

      const purchased = homeBuild.breakdown[fixture.stat].find((entry) =>
        entry.source === "purchased"
      );
      assertEquals(purchased?.amount, fixture.purchased);
      const ring = homeBuild.breakdown[fixture.ringBreakdownStat].find((entry) =>
        entry.source === `ring:${fixture.ring}`
      );
      assertEquals(ring?.amount, fixture.ringAmount);
      assertEquals(ring?.result, fixture.expected[fixture.ringBreakdownStat]);

      const started = await rpc(sql`select public.start_run_v3(
        ${playerId}::uuid, '2026-08-26T07:00:00Z'::timestamptz
      ) as response`);
      assertEquals(started.status, "applied");
      const projection = started.projection as {
        selfSnapshot: SelfSnapshot;
        loadout: Readonly<Record<string, unknown>>;
      };
      assertEquals(projection.selfSnapshot, fixture.expected);
      assertEquals(started.build, home.build);
      assertEquals(projection.loadout.items, homeBuild.loadoutSnapshot.items);
      assertEquals(projection.loadout.rings, homeBuild.loadoutSnapshot.rings);

      if (fixture.ring === "weapon") {
        await sql`update game.player_stats set physical = physical + 1
          where player_id = ${playerId}::uuid`;
        await sql`update game.player_stat_progression
          set physical_purchased = physical_purchased + 1
          where player_id = ${playerId}::uuid`;
        const changedHome = await rpc(
          sql`select public.player_home_v1(${playerId}::uuid) as response`,
        );
        assertEquals(
          (changedHome.build as { selfSnapshot: SelfSnapshot }).selfSnapshot.physical,
          10,
        );
        const cached = await rpc(sql`select public.start_run_v3(
          ${playerId}::uuid, '2026-08-26T07:00:00Z'::timestamptz
        ) as response`);
        assertEquals(cached.status, "cached");
        assertEquals(
          (cached.build as { selfSnapshot: SelfSnapshot }).selfSnapshot,
          fixture.expected,
        );
        assertEquals(
          (cached.projection as { selfSnapshot: SelfSnapshot }).selfSnapshot,
          fixture.expected,
        );
      }
    }
  });
});

Deno.test("canonical build fails closed when a ring requirement and main item disagree", async () => {
  await withDatabase(async (sql) => {
    const fixture: BuildCase = {
      ...buildCases[0],
      externalId: 940000000000000035n,
      main: "apprentice_focus",
    };
    const playerId = await seedCompletedBuild(sql, fixture);
    const home = await rpc(sql`select public.player_home_v1(${playerId}::uuid) as response`);
    assertEquals(home, { status: "rejected", reason: "invalid_build" });
  });
});
