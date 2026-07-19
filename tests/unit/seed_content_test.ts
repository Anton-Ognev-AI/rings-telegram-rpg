import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import { buildContentSeedRecord } from "../../scripts/db/seed-content.ts";

Deno.test("content seed validates and seals the reviewed fallback", async () => {
  const record = await buildContentSeedRecord(fallback, "2026-07-13");

  assertEquals(record.externalId, "case-001-day-01");
  assertEquals(
    record.payloadSha256,
    "9000f0cebc29e6483b80de0bf8cf09c6f926821d317c17890654bc343fbb1c81",
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

Deno.test("content seed rejects Windows PowerShell UTF-8 mojibake", async () => {
  const corrupted = structuredClone(fallback) as typeof fallback;
  corrupted.stages[0]!.scene = new TextDecoder("windows-1251").decode(
    new TextEncoder().encode(corrupted.stages[0]!.scene),
  );

  await assertRejects(
    () => buildContentSeedRecord(corrupted, "2026-07-13"),
    Error,
    "invalid fallback content: suspicious_mojibake",
  );
});
