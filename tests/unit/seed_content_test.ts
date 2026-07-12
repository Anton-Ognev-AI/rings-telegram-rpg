import { assertEquals } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import { buildContentSeedRecord } from "../../scripts/db/seed-content.ts";

Deno.test("content seed validates and seals the reviewed fallback", async () => {
  const record = await buildContentSeedRecord(fallback, "2026-07-13");

  assertEquals(record.externalId, "case-001-day-01");
  assertEquals(
    record.payloadSha256,
    "9f136eb4d007c6c6b112aaece1f996906b8dad893318ebcc1e95d376b8e84851",
  );
  assertEquals(record.validationStatus, "fallback_validated");
  assertEquals(record.cycleId, "2026-07-13");
});

Deno.test("content seed rejects invalid content before database access", async () => {
  const invalid = structuredClone(fallback) as Record<string, unknown>;
  invalid.stages = [];

  let message = "";
  try {
    await buildContentSeedRecord(invalid, "2026-07-13");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(message.includes("invalid fallback content"), true);
});
