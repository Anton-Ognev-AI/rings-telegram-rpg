import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  assertNoRemoteSupabaseLink,
  localVerificationEnvironment,
  phase3VerificationSteps,
} from "../../scripts/verify-phase3.ts";

Deno.test("Phase 3 verification is sequential and isolates stateful E2E groups", () => {
  const labels = phase3VerificationSteps.map((step) => step.label);
  assertEquals(labels[0], "start local Supabase");
  assertEquals(phase3VerificationSteps[0]?.suppressStdout, true);
  assertEquals(labels[1], "source verification");
  assertEquals(labels.includes("283 pgTAP assertions"), true);
  assertEquals(labels.includes("Phase 2 deletion recovery"), true);
  assertEquals(labels.includes("6000 callback load"), true);
  assertEquals(labels.at(-1), "migration checksums");

  for (const label of ["lifecycle E2E", "delivery fault E2E", "6000 callback load"]) {
    const index = labels.indexOf(label);
    assertEquals(index > 0, true);
    assertEquals(labels[index - 1], `clean reset for ${label}`);
  }
  const e2eSteps = phase3VerificationSteps.filter((step) =>
    step.label.endsWith("E2E") && !step.label.startsWith("clean reset")
  );
  assertEquals(
    e2eSteps.every((step) => step.args.filter((arg) => arg.endsWith("_test.ts")).length === 1),
    true,
  );
});

Deno.test("Phase 3 verification rejects remote inherited state before running commands", () => {
  assertEquals(localVerificationEnvironment({ TEST_DATABASE_URL: "postgresql://x@localhost/db" }), {
    TEST_DATABASE_URL: "postgresql://x@localhost/db",
  });
  assertEquals(localVerificationEnvironment({ SAFE: "yes" }), { SAFE: "yes" });

  const forbidden: ReadonlyArray<Record<string, string>> = [
    { ALLOW_REMOTE_TEST_DB: "1" },
    { TEST_DATABASE_URL: "postgresql://x@example.com/db" },
    { TEST_DATABASE_URL: "https://localhost/db" },
    { TEST_DATABASE_URL: "not-a-url" },
  ];
  for (const environment of forbidden) {
    assertThrows(() => localVerificationEnvironment(environment));
  }
  assertThrows(() => assertNoRemoteSupabaseLink(true));
  assertEquals(assertNoRemoteSupabaseLink(false), undefined);
});
