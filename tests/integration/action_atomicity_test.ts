import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import { createFixture, effectCounts, prepare, resolve } from "./helpers/database.ts";

Deno.test("tamper, apply, cached-before-stale and lost response keep one effect", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createFixture(sql, {
      playerId: "50000000-0000-4000-8000-000000000002",
      cycleId: "2026-08-02",
      telegramId: 900000000000000102n,
    });
    const action = await prepare(sql, fixture, "atomic-primary");
    const competitor = await prepare(sql, fixture, "atomic-competitor", "s1-failure", "failure");
    assertEquals(action.response.status, "ok");

    const wrongContext = await resolve(sql, {
      ...action,
      context: "0".repeat(64),
      updateId: 700000000000000100n,
      playerId: fixture.playerId,
    });
    assertEquals(wrongContext.status, "rejected");

    const tampered = await resolve(sql, {
      ...action,
      updateId: 700000000000000101n,
      playerId: "50000000-0000-4000-8000-000000000099",
    });
    assertEquals(tampered.status, "rejected");
    assertEquals(await effectCounts(sql, fixture.runId), {
      stateVersion: 0,
      stageResults: 0,
      ledger: 0,
      outbox: 0,
      processed: 0,
    });

    const applied = await resolve(sql, {
      ...action,
      updateId: 700000000000000102n,
      playerId: fixture.playerId,
    });
    assertEquals(applied.status, "applied");

    const updateConflict = await resolve(sql, {
      ...competitor,
      updateId: 700000000000000102n,
      playerId: fixture.playerId,
    });
    assertEquals(updateConflict.status, "rejected");
    assertEquals(updateConflict.reason, "update_id_conflict");

    // Treat the committed return as lost, reconnect logically, and replay with another update ID.
    const replay = await withDatabase((retrySql) =>
      resolve(retrySql, {
        ...action,
        updateId: 700000000000000103n,
        playerId: fixture.playerId,
      })
    );
    assertEquals(replay.status, "cached");
    assertEquals((replay.result as { status: string }).status, "applied");
    assertEquals(await effectCounts(sql, fixture.runId), {
      stateVersion: 1,
      stageResults: 1,
      ledger: 1,
      outbox: 1,
      processed: 1,
    });
  });
});

Deno.test("a zero-XP outcome still advances atomically without a zero ledger row", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createFixture(sql, {
      playerId: "50000000-0000-4000-8000-000000000003",
      cycleId: "2026-08-03",
      telegramId: 900000000000000103n,
    });
    const action = await prepare(sql, fixture, "zero-xp", "s1-failure", "failure");
    const applied = await resolve(sql, {
      ...action,
      updateId: 700000000000000104n,
      playerId: fixture.playerId,
    });

    assertEquals(applied.status, "applied");
    assertEquals(await effectCounts(sql, fixture.runId), {
      stateVersion: 1,
      stageResults: 1,
      ledger: 0,
      outbox: 1,
      processed: 1,
    });
  });
});

Deno.test("a processed token still enforces actor and context binding", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createFixture(sql, {
      playerId: "50000000-0000-4000-8000-000000000004",
      cycleId: "2026-08-04",
      telegramId: 900000000000000104n,
    });
    const action = await prepare(sql, fixture, "processed-binding");
    assertEquals(
      (await resolve(sql, {
        ...action,
        updateId: 700000000000000105n,
        playerId: fixture.playerId,
      })).status,
      "applied",
    );

    assertEquals(
      (await resolve(sql, {
        ...action,
        updateId: 700000000000000106n,
        playerId: "50000000-0000-4000-8000-000000000099",
      })).status,
      "rejected",
    );
    assertEquals(
      (await resolve(sql, {
        ...action,
        context: "0".repeat(64),
        updateId: 700000000000000107n,
        playerId: fixture.playerId,
      })).status,
      "rejected",
    );
  });
});
