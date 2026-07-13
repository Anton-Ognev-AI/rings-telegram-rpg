import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import { resumeRun } from "../../supabase/functions/_shared/application/resume.ts";
import { startTelegramRun } from "../../supabase/functions/_shared/application/start-telegram-run.ts";
import { getTelegramIdentity } from "../../supabase/functions/_shared/application/telegram-identity.ts";
import {
  canonicalJson,
  sha256Hex,
} from "../../supabase/functions/_shared/domain/canonical-json.ts";
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";

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

interface BoundarySample {
  readonly name: string;
  readonly cycleId: string;
  readonly previousCycleId: string;
  readonly opensAt: string;
  readonly beforeOpen: string;
  readonly beforeClose: string;
  readonly closesAt: string;
  readonly beforeGraceEnd: string;
  readonly graceEndsAt: string;
  readonly spanHours: number;
}

const boundaries: readonly BoundarySample[] = [
  {
    name: "normal",
    cycleId: "2026-02-10",
    previousCycleId: "2026-02-09",
    opensAt: "2026-02-10T07:00:00.000Z",
    beforeOpen: "2026-02-10T06:59:59.999Z",
    beforeClose: "2026-02-11T06:59:59.999Z",
    closesAt: "2026-02-11T07:00:00.000Z",
    beforeGraceEnd: "2026-02-11T08:59:59.999Z",
    graceEndsAt: "2026-02-11T09:00:00.000Z",
    spanHours: 24,
  },
  {
    name: "spring DST",
    cycleId: "2026-03-28",
    previousCycleId: "2026-03-27",
    opensAt: "2026-03-28T07:00:00.000Z",
    beforeOpen: "2026-03-28T06:59:59.999Z",
    beforeClose: "2026-03-29T05:59:59.999Z",
    closesAt: "2026-03-29T06:00:00.000Z",
    beforeGraceEnd: "2026-03-29T07:59:59.999Z",
    graceEndsAt: "2026-03-29T08:00:00.000Z",
    spanHours: 23,
  },
  {
    name: "autumn DST",
    cycleId: "2026-10-24",
    previousCycleId: "2026-10-23",
    opensAt: "2026-10-24T06:00:00.000Z",
    beforeOpen: "2026-10-24T05:59:59.999Z",
    beforeClose: "2026-10-25T06:59:59.999Z",
    closesAt: "2026-10-25T07:00:00.000Z",
    beforeGraceEnd: "2026-10-25T08:59:59.999Z",
    graceEndsAt: "2026-10-25T09:00:00.000Z",
    spanHours: 25,
  },
];

Deno.test("normal and DST cycles honor every open, close, and grace boundary", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    for (const sample of boundaries) {
      const published = await publishFallbackDay(database, sample.opensAt);
      assertEquals(published.status === "applied" || published.status === "cached", true);
      const [shape] = await sql<{
        opens_at: string;
        closes_at: string;
        grace_ends_at: string;
        span_hours: number;
      }[]>`select opens_at::text, closes_at::text, grace_ends_at::text,
          extract(epoch from (closes_at - opens_at))::integer / 3600 as span_hours
        from game.dungeon_days where cycle_id = ${sample.cycleId}::date`;
      assertEquals(shape.span_hours, sample.spanHours, sample.name);

      const [mapped] = await sql<{ before_cycle: string; open_cycle: string }[]>`select
          game.kyiv_cycle_id_v1(${sample.beforeOpen}::timestamptz)::text as before_cycle,
          game.kyiv_cycle_id_v1(${sample.opensAt}::timestamptz)::text as open_cycle`;
      assertEquals(mapped, {
        before_cycle: sample.previousCycleId,
        open_cycle: sample.cycleId,
      }, sample.name);

      for (
        const point of [
          { at: sample.beforeOpen, status: "fallback_ready" },
          { at: sample.opensAt, status: "open" },
          { at: sample.beforeClose, status: "open" },
          { at: sample.closesAt, status: "grace" },
          { at: sample.beforeGraceEnd, status: "grace" },
          { at: sample.graceEndsAt, status: "closed" },
        ]
      ) {
        assertEquals((await advanceDay(database, point.at)).status, "ok");
        const [day] = await sql<{ status: string }[]>`select status::text as status
          from game.dungeon_days where cycle_id = ${sample.cycleId}::date`;
        assertEquals(day.status, point.status, `${sample.name} at ${point.at}`);
      }
    }
  });
});

Deno.test("an old run resumes during grace, blocks the next day, expires, and abandon is idempotent", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    const identity = await getTelegramIdentity(database, {
      telegramExternalId: 995000000000000001n,
      create: true,
    });
    const playerId = String(identity.playerId);
    const snapshotSha = await sha256Hex(canonicalJson(snapshot));
    const loadoutSha = await sha256Hex(canonicalJson(loadout));

    await publishFallbackDay(database, "2026-11-02T07:00:00.000Z");
    await advanceDay(database, "2026-11-02T07:00:00.000Z");
    const first = await startTelegramRun(database, {
      playerId,
      at: "2026-11-02T07:00:00.000Z",
      selfSnapshot: snapshot,
      selfSnapshotSha256: snapshotSha,
      loadoutSnapshot: loadout,
      loadoutSnapshotSha256: loadoutSha,
    });
    const firstRunId = String((first.projection as { run: { id: string } }).run.id);

    await publishFallbackDay(database, "2026-11-03T07:00:00.000Z");
    await advanceDay(database, "2026-11-03T08:00:00.000Z");
    const resumed = await resumeRun(database, playerId);
    assertEquals(resumed.status, "ok");
    assertEquals((resumed.run as { id: string; status: string }).id, firstRunId);
    assertEquals((resumed.run as { status: string }).status, "active");

    const blocked = await startTelegramRun(database, {
      playerId,
      at: "2026-11-03T08:00:00.000Z",
      selfSnapshot: snapshot,
      selfSnapshotSha256: snapshotSha,
      loadoutSnapshot: loadout,
      loadoutSnapshotSha256: loadoutSha,
    });
    assertEquals(blocked.status, "rejected");
    assertEquals(blocked.reason, "old_run_active");

    const expired = await advanceDay(database, "2026-11-03T09:00:00.000Z");
    assertEquals(expired.runsExpired, 1);
    assertEquals((await resumeRun(database, playerId)).status, "none");

    const second = await startTelegramRun(database, {
      playerId,
      at: "2026-11-03T09:00:00.000Z",
      selfSnapshot: snapshot,
      selfSnapshotSha256: snapshotSha,
      loadoutSnapshot: loadout,
      loadoutSnapshotSha256: loadoutSha,
    });
    assertEquals(second.status, "applied");
    const secondRunId = String((second.projection as { run: { id: string } }).run.id);
    assertNotEquals(secondRunId, firstRunId);
    assertEquals(
      await database.call("abandon_run_v1", {
        p_player_id: playerId,
        p_run_id: secondRunId,
      }),
      { status: "applied", runId: secondRunId },
    );
    assertEquals(
      await database.call("abandon_run_v1", {
        p_player_id: playerId,
        p_run_id: secondRunId,
      }),
      { status: "cached", runId: secondRunId },
    );

    const [statuses] = await sql<{ first_status: string; second_status: string }[]>`select
        (select status::text from game.runs where id = ${firstRunId}::uuid) as first_status,
        (select status::text from game.runs where id = ${secondRunId}::uuid) as second_status`;
    assertEquals(statuses, { first_status: "expired", second_status: "abandoned" });
  });
});
