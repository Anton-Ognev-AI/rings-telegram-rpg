import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import { createFixture, effectCounts, prepare, resolve } from "./helpers/database.ts";

Deno.test("100 duplicate callbacks and competing choices have one effect", async () => {
  await withDatabase(async (sql) => {
    for (let iteration = 0; iteration < 5; iteration++) {
      const suffix = (iteration + 10).toString().padStart(12, "0");
      const fixture = await createFixture(sql, {
        playerId: `51000000-0000-4000-8000-${suffix}`,
        cycleId: `2026-09-${(iteration + 1).toString().padStart(2, "0")}`,
        telegramId: 900000000000001000n + BigInt(iteration),
      });
      const action = await prepare(sql, fixture, `duplicates-${iteration}`);
      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          resolve(sql, {
            ...action,
            updateId: 700000000000001000n + BigInt(iteration),
            playerId: fixture.playerId,
          })),
      );
      assertEquals(results.filter((result) => result.status === "applied").length, 1);
      assertEquals(results.filter((result) => result.status === "cached").length, 99);
      assertEquals(await effectCounts(sql, fixture.runId), {
        stateVersion: 1,
        stageResults: 1,
        ledger: 1,
        outbox: 1,
        processed: 1,
      });
    }

    for (let iteration = 0; iteration < 5; iteration++) {
      const suffix = (iteration + 20).toString().padStart(12, "0");
      const fixture = await createFixture(sql, {
        playerId: `52000000-0000-4000-8000-${suffix}`,
        cycleId: `2026-10-${(iteration + 1).toString().padStart(2, "0")}`,
        telegramId: 900000000000002000n + BigInt(iteration),
      });
      const first = await prepare(sql, fixture, `race-first-${iteration}`, "s1-neutral", "neutral");
      const second = await prepare(
        sql,
        fixture,
        `race-second-${iteration}`,
        "s1-success",
        "success",
      );
      const results = await Promise.all([
        resolve(sql, {
          ...first,
          updateId: 700000000000002000n + BigInt(iteration * 2),
          playerId: fixture.playerId,
        }),
        resolve(sql, {
          ...second,
          updateId: 700000000000002001n + BigInt(iteration * 2),
          playerId: fixture.playerId,
        }),
      ]);
      assertEquals(results.map((result) => result.status).sort(), ["applied", "stale"]);
      assertEquals(await effectCounts(sql, fixture.runId), {
        stateVersion: 1,
        stageResults: 1,
        ledger: 1,
        outbox: 1,
        processed: 1,
      });
    }
  });
});
