import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import { createFixture } from "./helpers/database.ts";

Deno.test("start and resume preserve the pinned run projection", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createFixture(sql, {
      playerId: "50000000-0000-4000-8000-000000000001",
      cycleId: "2026-08-01",
      telegramId: 900000000000000101n,
    });
    const [resumed] = await sql<
      { response: { status: string; run: { id: string; stage: number } } }[]
    >`
      select public.resume_v1(${fixture.playerId}::uuid) as response
    `;
    assertEquals(resumed.response.status, "ok");
    assertEquals(resumed.response.run.id, fixture.runId);
    assertEquals(resumed.response.run.stage, 1);
  });
});
