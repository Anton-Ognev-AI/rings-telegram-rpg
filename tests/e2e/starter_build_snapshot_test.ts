import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import type { Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { SelfSnapshot } from "../../supabase/functions/_shared/contracts/domain.ts";
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";

type Ring = "weapon" | "fire" | "defense" | "healing";
type Main = "training_sword" | "apprentice_focus";
type Support = "training_armor" | "student_talisman";

interface SnapshotCase {
  readonly externalId: bigint;
  readonly ring: Ring;
  readonly main: Main;
  readonly support: Support;
  readonly physical: number;
  readonly magical: number;
}

const cases: readonly SnapshotCase[] = [
  {
    externalId: 920000601n,
    ring: "weapon",
    main: "training_sword",
    support: "training_armor",
    physical: 6,
    magical: 5,
  },
  {
    externalId: 920000602n,
    ring: "fire",
    main: "apprentice_focus",
    support: "student_talisman",
    physical: 5,
    magical: 6,
  },
  {
    externalId: 920000603n,
    ring: "defense",
    main: "training_sword",
    support: "student_talisman",
    physical: 6,
    magical: 5,
  },
  {
    externalId: 920000604n,
    ring: "healing",
    main: "apprentice_focus",
    support: "training_armor",
    physical: 5,
    magical: 6,
  },
];

function mainBonus(main: Main) {
  return main === "training_sword" ? { physical: 2 } : { magical: 2 };
}

function supportBonus(support: Support) {
  return support === "training_armor" ? { defense: 2 } : { maxHp: 4 };
}

function caseDays(index: number): readonly [string, string, string] {
  const first = Date.parse("2026-10-20T07:00:00.000Z") + index * 3 * 24 * 60 * 60 * 1000;
  const at = (offset: number) => new Date(first + offset * 24 * 60 * 60 * 1000).toISOString();
  return [at(0), at(1), at(2)];
}

async function publishDays(
  database: PostgresRpcDatabase,
  days: readonly [string, string, string],
): Promise<void> {
  for (const at of days) {
    const published = await database.call<{ status: string }>("publish_fallback_day_v1", {
      p_at: at,
    });
    assertEquals(published.status === "applied" || published.status === "cached", true);
  }
}

async function start(
  database: PostgresRpcDatabase,
  playerId: string,
  at: string,
) {
  const advanced = await database.call<{ status: string }>("advance_day_v2", { p_at: at });
  assertEquals(advanced.status, "ok");
  const result = await database.call<{
    status: string;
    projection: {
      run: { id: string };
      selfSnapshot: SelfSnapshot;
      loadout: { items: readonly { itemKey: string }[]; rings: readonly { kind: Ring }[] };
    };
  }>("start_run_v3", { p_player_id: playerId, p_at: at });
  assertEquals(result.status, "applied");
  return result.projection;
}

async function finishFixtureRun(sql: Sql, runId: string, at: string): Promise<void> {
  await sql`update game.runs set status = 'defeated', finished_at = ${at}::timestamptz
    where id = ${runId}::uuid`;
}

Deno.test("all four starter rings affect run three while two earlier snapshots remain immutable", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    for (const [caseIndex, fixture] of cases.entries()) {
      const days = caseDays(caseIndex);
      await publishDays(database, days);
      const identity = await database.call<{ status: string; playerId: string }>(
        "telegram_identity_v2",
        { p_external_id: fixture.externalId.toString(), p_create_if_missing: true },
      );
      assertEquals(identity.status, "ok");
      await sql`update game.player_stats set
          physical = ${fixture.physical}, magical = ${fixture.magical}
        where player_id = ${identity.playerId}::uuid`;

      const first = await start(database, identity.playerId, days[0]);
      await finishFixtureRun(sql, first.run.id, days[0]);
      await sql`update game.player_onboarding set
          tutorial_completed = 1,
          initial_training_resolved_at = ${days[0]}::timestamptz
        where player_id = ${identity.playerId}::uuid`;

      const second = await start(database, identity.playerId, days[1]);
      await finishFixtureRun(sql, second.run.id, days[1]);
      const beforeBuild = await sql<{
        id: string;
        self_snapshot: SelfSnapshot;
        self_sha: string;
        loadout_sha: string;
      }[]>`select id, self_snapshot, self_snapshot_sha256 as self_sha,
          loadout_snapshot_sha256 as loadout_sha
        from game.runs where id in (${first.run.id}::uuid, ${second.run.id}::uuid)
        order by started_at`;

      await sql`update game.player_onboarding set
          tutorial_completed = 2, academy_rank = 'novice'
        where player_id = ${identity.playerId}::uuid`;
      await sql`insert into game.player_equipment(player_id, slot, item_key, bonuses) values
        (${identity.playerId}::uuid, 'main', ${fixture.main},
          ${sql.json(mainBonus(fixture.main))}::jsonb),
        (${identity.playerId}::uuid,
          ${fixture.support === "training_armor" ? "armor" : "talisman"},
          ${fixture.support}, ${sql.json(supportBonus(fixture.support))}::jsonb)`;
      await sql`insert into game.player_rings(player_id, ring_kind, progression_config_id) values (
        ${identity.playerId}::uuid, ${fixture.ring},
        '00000000-0000-4000-8000-000000000002'::uuid
      )`;

      const third = await start(database, identity.playerId, days[2]);
      const afterBuild = await sql<{
        id: string;
        self_snapshot: SelfSnapshot;
        self_sha: string;
        loadout_sha: string;
      }[]>`select id, self_snapshot, self_snapshot_sha256 as self_sha,
          loadout_snapshot_sha256 as loadout_sha
        from game.runs where id in (${first.run.id}::uuid, ${second.run.id}::uuid)
        order by started_at`;
      assertEquals(afterBuild, beforeBuild);
      assertEquals(first.selfSnapshot, beforeBuild[0]?.self_snapshot);
      assertEquals(second.selfSnapshot, beforeBuild[1]?.self_snapshot);
      assertNotEquals(third.selfSnapshot, second.selfSnapshot);
      assertEquals(third.loadout.rings.map((ring) => ring.kind), [fixture.ring]);
      assertEquals(third.loadout.items.some((item) => item.itemKey === fixture.main), true);
      assertEquals(third.loadout.items.some((item) => item.itemKey === fixture.support), true);

      if (fixture.ring === "weapon") {
        assertEquals(third.selfSnapshot.physical > second.selfSnapshot.physical, true);
      } else if (fixture.ring === "fire") {
        assertEquals(third.selfSnapshot.magical > second.selfSnapshot.magical, true);
      } else if (fixture.ring === "defense") {
        assertEquals(third.selfSnapshot.defense > second.selfSnapshot.defense, true);
      } else {
        assertEquals(third.selfSnapshot.postHeal, 1);
      }
    }
  });
});
