import {
  assertStagingProjectPolicy,
  parseStagingCliArgs,
  type StagingCliOptions,
} from "./project-policy.ts";

const APP_CONFIRMATION = "TG_GAME_CONFIRMED_STAGING_APP_REF";
const RECOVERY_CONFIRMATION = "TG_GAME_CONFIRMED_STAGING_RECOVERY_REF";
const DENIED_REFS = "TG_GAME_DENIED_PROJECT_REFS";
const LINK_PATH = "supabase/.temp/project-ref";
const APP_MIGRATION_ROOT = "supabase/migrations";
const APP_MANIFEST_PATH = `${APP_MIGRATION_ROOT}/SHA256SUMS`;
const RECOVERY_MIGRATION_ROOT = "recovery-control/migrations";
const RECOVERY_MANIFEST_PATH = `${RECOVERY_MIGRATION_ROOT}/SHA256SUMS`;
const REQUIRED_MIGRATIONS = [
  "202607150014_tutorial_starter.sql",
  "202607150015_owner_smoke_readiness.sql",
  "202607150016_current_card_render_cache.sql",
] as const;
const REQUIRED_RECOVERY_MIGRATIONS = [
  "202607130001_deletion_tombstones.sql",
  "202607150002_record_deletion_tombstone.sql",
] as const;
const TEXT_FILE = /(?:\.(?:ts|tsx|js|json|md|sql|toml|ya?ml|txt|example)|\.gitignore)$/i;
const TELEGRAM_TOKEN = /\b\d{8,10}:[A-Za-z0-9_-]{35,}\b/;
const SUPABASE_SECRET = /\bsb_secret_[A-Za-z0-9_-]{20,}\b/;

export interface OwnerSmokePreflightDependencies {
  readonly getEnvironment: (name: string) => string | undefined;
  readonly listTrackedPaths: () => Promise<readonly string[]>;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly readOptionalTextFile: (path: string) => Promise<string | null>;
}

export interface OwnerSmokePreflightResult {
  readonly status: "ready";
  readonly mode: "dry-run" | "remote";
  readonly checks: number;
  readonly migrationsVerified: number;
  readonly trackedFilesScanned: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isTrackedEnvironment(path: string): boolean {
  const name = normalizePath(path).split("/").at(-1)?.toLowerCase() ?? "";
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
}

function deniedRefs(value: string | undefined): readonly string[] {
  if (!value) return [];
  const entries = value.split(",");
  if (entries.some((entry) => entry.length === 0 || entry !== entry.trim())) {
    fail("invalid_staging_denylist");
  }
  return entries;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function manifestEntries(value: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const line of value.split("\n")) {
    if (line === "") continue;
    const match = /^([0-9a-f]{64})[ ]{2}(\d{12}_.+\.sql)$/.exec(line);
    if (!match || result.has(match[2]!)) fail("invalid_migration_manifest");
    result.set(match[2]!, match[1]!);
  }
  return result;
}

async function verifyMigrationSet(
  dependencies: OwnerSmokePreflightDependencies,
  trackedPaths: readonly string[],
  root: string,
  manifestPath: string,
  required: readonly string[],
  missingCode: string,
): Promise<number> {
  const manifest = manifestEntries(await dependencies.readTextFile(manifestPath));
  const migrationPaths = trackedPaths.filter((path) => {
    if (!path.startsWith(`${root}/`)) return false;
    const name = path.slice(root.length + 1);
    return /^\d{12}_.+\.sql$/.test(name);
  }).sort();
  if (manifest.size !== migrationPaths.length) fail("migration_manifest_incomplete");
  for (const path of migrationPaths) {
    const name = path.split("/").at(-1)!;
    const expected = manifest.get(name);
    if (!expected || await sha256(await dependencies.readTextFile(path)) !== expected) {
      fail("migration_checksum_drift");
    }
  }
  if (required.some((name) => !manifest.has(name))) fail(missingCode);
  return migrationPaths.length;
}

export async function preflightOwnerSmoke(
  options: StagingCliOptions,
  dependencies: OwnerSmokePreflightDependencies,
): Promise<OwnerSmokePreflightResult> {
  const linkedValue = await dependencies.readOptionalTextFile(LINK_PATH);
  const linkedProjectRef = linkedValue === null ? null : linkedValue.trim();
  const policy = assertStagingProjectPolicy({
    ...options,
    confirmedProjectRef: dependencies.getEnvironment(APP_CONFIRMATION),
    confirmedRecoveryProjectRef: dependencies.getEnvironment(RECOVERY_CONFIRMATION),
    deniedProjectRefs: deniedRefs(dependencies.getEnvironment(DENIED_REFS)),
    linkedProjectRef,
  });

  const trackedPaths = (await dependencies.listTrackedPaths()).map(normalizePath);
  if (trackedPaths.some(isTrackedEnvironment)) fail("tracked_environment_forbidden");

  const appMigrations = await verifyMigrationSet(
    dependencies,
    trackedPaths,
    APP_MIGRATION_ROOT,
    APP_MANIFEST_PATH,
    REQUIRED_MIGRATIONS,
    "phase4_migrations_missing",
  );
  const recoveryMigrations = await verifyMigrationSet(
    dependencies,
    trackedPaths,
    RECOVERY_MIGRATION_ROOT,
    RECOVERY_MANIFEST_PATH,
    REQUIRED_RECOVERY_MIGRATIONS,
    "recovery_migrations_missing",
  );

  const tutorialMigration = await dependencies.readTextFile(
    `supabase/migrations/${REQUIRED_MIGRATIONS[0]}`,
  );
  const seed = await dependencies.readTextFile("supabase/seed.sql");
  if (
    !tutorialMigration.includes("tutorial_starter_enabled") ||
    !seed.includes("tutorial_starter_enabled") || !seed.includes("true")
  ) {
    fail("phase4_feature_flag_missing");
  }

  for (const path of trackedPaths) {
    if (!TEXT_FILE.test(path)) continue;
    const content = await dependencies.readTextFile(path);
    if (TELEGRAM_TOKEN.test(content) || SUPABASE_SECRET.test(content)) {
      fail("tracked_credential_material");
    }
  }

  return {
    status: "ready",
    mode: policy.mode,
    checks: 8,
    migrationsVerified: appMigrations + recoveryMigrations,
    trackedFilesScanned: trackedPaths.length,
  };
}

async function listTrackedPaths(): Promise<readonly string[]> {
  const output = await new Deno.Command("git", {
    args: ["ls-files", "-z"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) fail("tracked_file_listing_failed");
  return new TextDecoder().decode(output.stdout).split("\0").filter(Boolean);
}

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

export const defaultOwnerSmokePreflightDependencies: OwnerSmokePreflightDependencies = {
  getEnvironment: (name) => Deno.env.get(name),
  listTrackedPaths,
  readTextFile: (path) => Deno.readTextFile(path),
  readOptionalTextFile,
};

async function main(): Promise<void> {
  try {
    const result = await preflightOwnerSmoke(
      parseStagingCliArgs(Deno.args),
      defaultOwnerSmokePreflightDependencies,
    );
    console.log(JSON.stringify(result));
  } catch {
    console.error(JSON.stringify({ status: "rejected" }));
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
