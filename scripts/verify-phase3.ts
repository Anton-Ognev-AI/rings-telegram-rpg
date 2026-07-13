export interface VerificationStep {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly isolatedProfile?: boolean;
  readonly suppressStdout?: boolean;
}

const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function localVerificationEnvironment(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  if (input.ALLOW_REMOTE_TEST_DB?.trim()) {
    throw new Error("phase3_remote_database_override_forbidden");
  }
  const databaseUrl = input.TEST_DATABASE_URL?.trim();
  if (databaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      throw new Error("phase3_invalid_test_database_url");
    }
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      !LOOPBACK_HOSTS.has(parsed.hostname)
    ) {
      throw new Error("phase3_non_loopback_database_forbidden");
    }
  }
  const environment = { ...input };
  delete environment.ALLOW_REMOTE_TEST_DB;
  return environment;
}

export function assertNoRemoteSupabaseLink(linked: boolean): void {
  if (linked) throw new Error("phase3_remote_supabase_link_forbidden");
}

function npmRun(label: string, script: string, isolatedProfile = false): VerificationStep {
  return { label, command: npm, args: ["run", script], isolatedProfile };
}

function denoThroughNpm(label: string, args: readonly string[]): VerificationStep {
  return { label, command: npm, args: ["run", "deno", "--", ...args] };
}

function reset(label: string): VerificationStep {
  return npmRun(`clean reset for ${label}`, "db:reset", true);
}

export const phase3VerificationSteps: readonly VerificationStep[] = [
  { ...npmRun("start local Supabase", "db:start", true), suppressStdout: true },
  npmRun("source verification", "verify"),
  reset("database regressions"),
  npmRun("283 pgTAP assertions", "test:db:unit"),
  npmRun("Phase 2 integration regressions", "test:db:integration"),
  npmRun("Phase 2 concurrency regression", "test:db:concurrency"),
  npmRun("Phase 3 database contracts", "test:db:phase3a"),
  npmRun("Phase 2 deletion recovery", "test:db:deletion"),
  reset("Telegram E2E group"),
  denoThroughNpm("fallback E2E", [
    "test",
    "--allow-env",
    "--allow-net",
    "tests/e2e/fallback_solo_test.ts",
  ]),
  denoThroughNpm("restart E2E", [
    "test",
    "--allow-env",
    "--allow-net",
    "tests/e2e/restart_resume_test.ts",
  ]),
  denoThroughNpm("privacy deletion E2E", [
    "test",
    "--allow-env",
    "--allow-net",
    "--allow-read",
    "tests/e2e/privacy_deletion_test.ts",
  ]),
  reset("lifecycle E2E"),
  denoThroughNpm("lifecycle E2E", [
    "test",
    "--allow-env",
    "--allow-net",
    "tests/e2e/grace_expiry_test.ts",
  ]),
  reset("delivery fault E2E"),
  denoThroughNpm("delivery fault E2E", [
    "test",
    "--allow-env",
    "--allow-net",
    "tests/e2e/outbox_faults_test.ts",
  ]),
  reset("6000 callback load"),
  npmRun("6000 callback load", "load:callbacks"),
  npmRun("database reconciliation", "db:reconcile"),
  npmRun("database lint", "db:lint", true),
  denoThroughNpm("migration checksums", [
    "run",
    "--allow-read",
    "scripts/db/migration-checksums.ts",
    "--verify",
  ]),
];

const stopLocalSupabase: VerificationStep = {
  label: "stop local Supabase",
  command: npm,
  args: ["run", "supabase", "--", "stop"],
  isolatedProfile: true,
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function runStep(
  step: VerificationStep,
  environment: Readonly<Record<string, string>>,
  isolatedEnvironment: Readonly<Record<string, string>>,
): Promise<void> {
  const process = new Deno.Command(step.command, {
    args: [...step.args],
    cwd: Deno.cwd(),
    env: step.isolatedProfile ? isolatedEnvironment : environment,
    stdin: "null",
    stdout: step.suppressStdout ? "null" : "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await process.status;
  if (!status.success) {
    throw new Error(`phase3_verification_failed:${step.label}:${status.code}`);
  }
}

async function main(): Promise<void> {
  assertNoRemoteSupabaseLink(await pathExists("supabase/.temp/project-ref"));
  const profile = await Deno.makeTempDir({ prefix: "tggame-phase3-verify-" });
  const environment = localVerificationEnvironment(Deno.env.toObject());
  const isolatedEnvironment = {
    ...environment,
    HOME: profile,
    USERPROFILE: profile,
  };
  let failure: unknown;
  let stackAttempted = false;
  try {
    for (const [index, step] of phase3VerificationSteps.entries()) {
      console.log(`[phase3 ${index + 1}/${phase3VerificationSteps.length}] ${step.label}`);
      if (step.label === "start local Supabase") stackAttempted = true;
      await runStep(step, environment, isolatedEnvironment);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (stackAttempted) {
      console.log("[phase3 cleanup] stop local Supabase");
      try {
        await runStep(stopLocalSupabase, environment, isolatedEnvironment);
      } catch (error) {
        failure ??= error;
      }
    }
    await Deno.remove(profile, { recursive: true }).catch(() => undefined);
  }
  if (failure) throw failure;
}

if (import.meta.main) await main();
