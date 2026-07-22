import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  assertStagingProjectPolicy,
  parseStagingCliArgs,
} from "../../scripts/staging/project-policy.ts";
import {
  type OwnerSmokePreflightDependencies,
  preflightOwnerSmoke,
} from "../../scripts/staging/preflight-owner-smoke.ts";

const APP_REF = "aaaaaaaaaaaaaaaaaaaa";
const RECOVERY_REF = "bbbbbbbbbbbbbbbbbbbb";

function options(executeRemote = false) {
  return {
    staging: true,
    executeRemote,
    projectRef: APP_REF,
    recoveryProjectRef: RECOVERY_REF,
  };
}

Deno.test("staging CLI is strict and offline by default", () => {
  assertEquals(
    parseStagingCliArgs([
      "--staging",
      "--project-ref",
      APP_REF,
      "--recovery-project-ref",
      RECOVERY_REF,
    ]),
    options(false),
  );
  assertEquals(
    parseStagingCliArgs([
      "--staging",
      "--project-ref",
      APP_REF,
      "--recovery-project-ref",
      RECOVERY_REF,
      "--execute-remote",
    ]),
    options(true),
  );
  for (
    const args of [
      [],
      ["--staging", "--project-ref", APP_REF],
      ["--project-ref", APP_REF, "--recovery-project-ref", RECOVERY_REF],
      ["--staging", "--project-ref", APP_REF, "--recovery-project-ref", RECOVERY_REF, "--unknown"],
    ]
  ) assertThrows(() => parseStagingCliArgs(args), Error, "invalid_staging_arguments");
});

Deno.test("staging policy requires two exact non-repository confirmations", () => {
  assertEquals(
    assertStagingProjectPolicy({
      ...options(),
      confirmedProjectRef: APP_REF,
      confirmedRecoveryProjectRef: RECOVERY_REF,
      deniedProjectRefs: [],
      linkedProjectRef: null,
    }),
    { mode: "dry-run", linked: false },
  );

  for (
    const amendment of [
      { confirmedProjectRef: RECOVERY_REF },
      { confirmedRecoveryProjectRef: APP_REF },
      { recoveryProjectRef: APP_REF },
      { deniedProjectRefs: [APP_REF] },
      { linkedProjectRef: "cccccccccccccccccccc" },
      { projectRef: "prod0000000000000000" },
    ]
  ) {
    assertThrows(
      () =>
        assertStagingProjectPolicy({
          ...options(),
          confirmedProjectRef: APP_REF,
          confirmedRecoveryProjectRef: RECOVERY_REF,
          deniedProjectRefs: [],
          linkedProjectRef: null,
          ...amendment,
        }),
      Error,
    );
  }
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function preflightDependencies(
  additions: Readonly<Record<string, string>> = {},
  includeDiscoveryMigration = true,
): Promise<OwnerSmokePreflightDependencies> {
  const migrations = {
    "supabase/migrations/202607150014_tutorial_starter.sql": "tutorial_starter_enabled",
    "supabase/migrations/202607150015_owner_smoke_readiness.sql": "reconciliation-only",
    "supabase/migrations/202607150016_current_card_render_cache.sql": "card_current",
    ...(includeDiscoveryMigration
      ? {
        "supabase/migrations/202607190017_tutorial_field_discovery.sql": "field_discovery",
      }
      : {}),
  };
  const manifest = (await Promise.all(
    Object.entries(migrations).map(async ([path, value]) =>
      `${await sha256(value)}  ${path.split("/").at(-1)}\n`
    ),
  )).join("");
  const recoveryMigrations = {
    "recovery-control/migrations/202607130001_deletion_tombstones.sql": "private table",
    "recovery-control/migrations/202607150002_record_deletion_tombstone.sql": "service RPC",
  };
  const recoveryManifest = (await Promise.all(
    Object.entries(recoveryMigrations).map(async ([path, value]) =>
      `${await sha256(value)}  ${path.split("/").at(-1)}\n`
    ),
  )).join("");
  const files: Record<string, string> = {
    ...migrations,
    "supabase/migrations/SHA256SUMS": manifest,
    ...recoveryMigrations,
    "recovery-control/migrations/SHA256SUMS": recoveryManifest,
    "supabase/config.toml": [
      "[functions.tg-webhook]",
      "verify_jwt = false",
      "[functions.outbox-worker]",
      "verify_jwt = true",
      "[functions.day-publish-reset]",
      "verify_jwt = true",
    ].join("\n"),
    "supabase/seed.sql": "tutorial_starter_enabled true",
    "scripts/safe.ts": "export const safe = true;",
    ...additions,
  };
  return {
    getEnvironment(name) {
      if (name === "TG_GAME_CONFIRMED_STAGING_APP_REF") return APP_REF;
      if (name === "TG_GAME_CONFIRMED_STAGING_RECOVERY_REF") return RECOVERY_REF;
      return undefined;
    },
    listTrackedPaths: () => Promise.resolve(Object.keys(files)),
    readTextFile: (path) => {
      if (!(path in files)) return Promise.reject(new Error("unexpected_file_read"));
      return Promise.resolve(files[path]!);
    },
    readOptionalTextFile: () => Promise.resolve(null),
  };
}

Deno.test("owner-smoke preflight verifies local migrations and scans tracked files only", async () => {
  const result = await preflightOwnerSmoke(options(), await preflightDependencies());
  assertEquals(result, {
    status: "ready",
    mode: "dry-run",
    checks: 9,
    migrationsVerified: 6,
    trackedFilesScanned: 11,
  });
});

Deno.test("owner-smoke preflight requires tutorial field discovery migration 017", async () => {
  const dependencies = await preflightDependencies({}, false);
  await assertRejects(
    () => preflightOwnerSmoke(options(), dependencies),
    Error,
    "phase4_migrations_missing",
  );
});

Deno.test("owner-smoke preflight rejects unsafe Edge Function JWT modes", async () => {
  for (
    const config of [
      "[functions.tg-webhook]\nverify_jwt = true",
      [
        "[functions.tg-webhook]",
        "verify_jwt = false",
        "[functions.outbox-worker]",
        "verify_jwt = false",
        "[functions.day-publish-reset]",
        "verify_jwt = true",
      ].join("\n"),
    ]
  ) {
    const dependencies = await preflightDependencies({ "supabase/config.toml": config });
    await assertRejects(
      () => preflightOwnerSmoke(options(), dependencies),
      Error,
      "unsafe_function_jwt_config",
    );
  }
});

Deno.test("owner-smoke preflight rejects recovery migration checksum drift", async () => {
  const dependencies = await preflightDependencies({
    "recovery-control/migrations/202607150002_record_deletion_tombstone.sql": "drift",
  });
  await assertRejects(
    () => preflightOwnerSmoke(options(), dependencies),
    Error,
    "migration_checksum_drift",
  );
});

Deno.test("owner-smoke preflight rejects tracked env or credential material without exposing it", async () => {
  const credential = `TELEGRAM_BOT_TOKEN=${"123456789:"}${"x".repeat(35)}`;
  const legacySupabaseJwt = [
    ["ey", "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"].join(""),
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0YWdpbmd0ZXN0In0",
    "syntheticSignatureSegmentForTrackedCredentialTest",
  ].join(".");
  const cases: ReadonlyArray<Readonly<Record<string, string>>> = [
    { ".env": "must-not-be-read" },
    { "scripts/leak.ts": credential },
    { "scripts/legacy-key.ts": `export const key = "${legacySupabaseJwt}";` },
  ];
  for (const additions of cases) {
    const dependencies = await preflightDependencies(additions);
    const error = await assertRejects(
      () => preflightOwnerSmoke(options(), dependencies),
      Error,
    );
    assertEquals(error.message.includes(credential), false);
    assertEquals(error.message.includes("must-not-be-read"), false);
  }
});
