import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  assertNoRemoteSupabaseLink,
  assertSyntheticFixtureSafety,
  executePhase4Verification,
  localVerificationEnvironment,
  phase4VerificationSteps,
  type Phase4VerifierRuntime,
  type VerificationStep,
} from "../../scripts/verify-phase4a.ts";

Deno.test("Phase 4 verifier refuses remote links and non-loopback inherited databases", () => {
  assertThrows(
    () => assertNoRemoteSupabaseLink(true),
    Error,
    "phase4_remote_supabase_link_forbidden",
  );
  assertThrows(
    () =>
      localVerificationEnvironment({
        TEST_DATABASE_URL: "postgres://user:secret@db.example.com:5432/game",
      }),
    Error,
    "phase4_non_loopback_database_forbidden",
  );
  assertThrows(
    () => localVerificationEnvironment({ ALLOW_REMOTE_TEST_DB: "1" }),
    Error,
    "phase4_remote_database_override_forbidden",
  );
});

Deno.test("Phase 4 verifier rejects PII, secrets, and non-synthetic Telegram identities", () => {
  assertSyntheticFixtureSafety("tests/fixtures/telegram/start.json", {
    message: { from: { id: 910000001 }, chat: { id: 910000001 } },
  });
  assertThrows(
    () =>
      assertSyntheticFixtureSafety("tests/fixtures/telegram/start.json", {
        message: { from: { id: 910000001, username: "real-person" } },
      }),
    Error,
    "phase4_fixture_pii_detected",
  );
  assertThrows(
    () =>
      assertSyntheticFixtureSafety("tests/fixtures/content.json", {
        credential: ["sk", "-", "abcdefghijklmnopqrstuvwxyz"].join(""),
      }),
    Error,
    "phase4_fixture_secret_detected",
  );
  assertThrows(
    () =>
      assertSyntheticFixtureSafety("tests/fixtures/telegram/start.json", {
        message: { from: { id: 123456789 }, chat: { id: 123456789 } },
      }),
    Error,
    "phase4_non_synthetic_identity",
  );
});

Deno.test("Phase 4 verifier keeps the complete ordered local regression list", () => {
  assertEquals(phase4VerificationSteps.map((step) => step.label), [
    "start local Supabase",
    "source verification",
    "clean reset for database regressions",
    "338 pgTAP assertions",
    "Phase 2 integration regressions",
    "Phase 2 concurrency regression",
    "Phase 3 database contracts",
    "Phase 2 deletion recovery",
    "Phase 4 progression integration",
    "Phase 4 progression concurrency",
    "Phase 4T local database controls",
    "upgrade from migration 013",
    "upgrade from migration 014",
    "clean reset for Phase 3 Telegram E2E",
    "fallback E2E",
    "restart E2E",
    "privacy deletion E2E",
    "clean reset for two-day tutorial E2E",
    "two-day tutorial E2E",
    "clean reset for tutorial terminal paths",
    "tutorial terminal paths",
    "clean reset for starter snapshot E2E",
    "starter snapshot E2E",
    "clean reset for lifecycle E2E",
    "lifecycle E2E",
    "clean reset for delivery fault E2E",
    "delivery fault E2E",
    "clean reset for 6000 callback load",
    "6000 callback load",
    "starter ring balance matrix",
    "database reconciliation",
    "database lint",
    "migration checksums",
  ]);
});

Deno.test("Phase 4 verifier always stops the attempted stack and removes its profile", async () => {
  const events: string[] = [];
  const runtime: Phase4VerifierRuntime = {
    hasRemoteLink: () => Promise.resolve(false),
    makeProfile: () => Promise.resolve("C:/synthetic/phase4-profile"),
    removeProfile: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    runStep: (step: VerificationStep, _environment, isolatedEnvironment) => {
      events.push(step.label);
      if (step.label === "start local Supabase") {
        assertEquals(isolatedEnvironment.DO_NOT_TRACK, "1");
        assertEquals(isolatedEnvironment.SUPABASE_TELEMETRY_DISABLED, "1");
        assertEquals(isolatedEnvironment.HOME, "C:/synthetic/phase4-profile");
        assertEquals(isolatedEnvironment.USERPROFILE, "C:/synthetic/phase4-profile");
      }
      if (step.label === "source verification") {
        return Promise.reject(new Error("synthetic_failure"));
      }
      return Promise.resolve();
    },
    verifyLocalPreflight: () => Promise.resolve(),
  };
  await assertRejects(
    () => executePhase4Verification(runtime, {}),
    Error,
    "synthetic_failure",
  );
  assertEquals(events, [
    "start local Supabase",
    "source verification",
    "stop local Supabase",
    "remove:C:/synthetic/phase4-profile",
  ]);
});
