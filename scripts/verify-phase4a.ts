export interface VerificationStep {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly isolatedProfile?: boolean;
  readonly suppressStdout?: boolean;
}

export interface Phase4VerifierRuntime {
  readonly hasRemoteLink: () => Promise<boolean>;
  readonly makeProfile: () => Promise<string>;
  readonly removeProfile: (path: string) => Promise<void>;
  readonly runStep: (
    step: VerificationStep,
    environment: Readonly<Record<string, string>>,
    isolatedEnvironment: Readonly<Record<string, string>>,
  ) => Promise<void>;
  readonly verifyLocalPreflight: () => Promise<void>;
}

const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SENSITIVE_FIXTURE_FIELDS = new Set([
  "email",
  "first_name",
  "ip_address",
  "last_name",
  "phone",
  "phone_number",
  "username",
]);
const SECRET_PATTERNS = [
  new RegExp(["\\b\\d{8,10}", ":", "[A-Za-z0-9_-]{35}\\b"].join("")),
  new RegExp(["\\b", "sk", "-", "[A-Za-z0-9_-]{20,}\\b"].join("")),
  new RegExp(["\\b", "sb_secret", "_", "[A-Za-z0-9_-]{20,}\\b"].join("")),
];
const SYNTHETIC_TELEGRAM_ID_MIN = 910_000_000;
const SYNTHETIC_TELEGRAM_ID_MAX = 999_999_999;

const LOCKED_BASELINE: Readonly<Record<string, string>> = {
  "supabase/migrations/202607120001_foundation.sql":
    "981bd65bfac8a35b086e0d2f09ac70172a5ba0dd6798bfee38522eaa793dbc2a",
  "supabase/migrations/202607120002_config.sql":
    "f8ad71883ce062acfe99375ba1ec9c1387f0eb5ef90c597dbbd054d17dc1edbc",
  "supabase/migrations/202607120003_players.sql":
    "6b4a1a6b71212d0d141aa94ba9cb5f8298ef2c7de1ef1c10564e1fb1ea08df5e",
  "supabase/migrations/202607120004_content.sql":
    "7cb35ef634cdc5da6c1aa6fc900ca2ba8c824942d5f1fcae81afbdbbe584fd6b",
  "supabase/migrations/202607120005_xp.sql":
    "27de83e6c8cd0e2249ca8f5e140592bc7ed8a189ade09e8bbfbbae918a3e6770",
  "supabase/migrations/202607120006_runs.sql":
    "c95b77cfcd0683c336cb9584590ac9edfcac82b6e04d0b8239ac674215250fec",
  "supabase/migrations/202607120007_actions_outbox.sql":
    "756470f16ad41d54745a3da084c2fabf3ee63347ac708aa0b367217d3a4b13a0",
  "supabase/migrations/202607120008_core_commands.sql":
    "e9d11d0add956cfd5d922adafe78117a7d2908c9d00be52eab162bec90c02e05",
  "supabase/migrations/202607130009_telegram_commands.sql":
    "b3ce2dc3b26d999a9ed510e3b63618db68f768c36b19966a8d441b51e3e22841",
  "supabase/migrations/202607130010_render_request.sql":
    "f722a77f188f1a4ff200a930542d073bc951e46495b0b36d9fe09028b4ee2c30",
  "supabase/migrations/202607130011_telegram_deletion_identity.sql":
    "67e8e15dc6aed07052e7ae8164db584d44f40a994622b529b4a1cafde82d6193",
  "supabase/migrations/202607130012_deletion_outbox_fence.sql":
    "1bf197731b7965ac3bf5afe4b08c0a66cdb3368533c598a69cee6e6818718c03",
  "supabase/migrations/202607130013_outbox_dispatch_fence.sql":
    "b8b7af75921297966449644f360217dc8864acb64e1b308f17c71b006e44a78e",
  "supabase/functions/_shared/domain/resolvers/v1/combat.ts":
    "d7a1dacc4cd8b2e5d3633df2872511e61b1035881d17bad3b2e1fa1108394d70",
  "supabase/functions/_shared/domain/resolvers/v1/config.ts":
    "fee44386575538bcef0be84807ebdec36596da5d493dceb9edbe1935a6231de4",
  "supabase/functions/_shared/domain/resolvers/v1/party.ts":
    "598e99b1d5e16ea828b08fd8641b4d3220ae58b45a93977ec2aeb41f42d691f1",
  "supabase/functions/_shared/domain/resolvers/v1/resolver.ts":
    "4e2d4904dfc36c070f0e575dc7a03e3f3cad41645c872fad3a07646430819428",
  "content/schemas/dungeon-v1.schema.json":
    "7a28ba23b3045c895c8edf90c594afb07f6ea91aef10b1bbf943ab50c3312162",
  "content/fallback/case-001/day-01.json":
    "1a898630afcd321f46573f1c3523fda182cbba854825ebd1ba3c2a3214ab32bb",
  "tests/fixtures/replays/v1/golden-full-run.json":
    "6d4deedc9d9e9aebe0943b30d2a142edfe84c4e21728ef6d8f69a193e48b4626",
  "tests/fixtures/replays/v1/golden-full-run.result.json":
    "8fa597ecebd30b88db68a3576adb161fc796358537535cb55deb2439d646be4b",
  "scripts/verify-phase3.ts": "d3645baa75d174cb1fc025530cfe791b3e40c0da0df69a039637ce90316354af",
};

export function localVerificationEnvironment(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  if (input.ALLOW_REMOTE_TEST_DB?.trim()) {
    throw new Error("phase4_remote_database_override_forbidden");
  }
  const databaseUrl = input.TEST_DATABASE_URL?.trim();
  if (databaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      throw new Error("phase4_invalid_test_database_url");
    }
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      !LOOPBACK_HOSTS.has(parsed.hostname)
    ) throw new Error("phase4_non_loopback_database_forbidden");
  }
  const environment = { ...input };
  delete environment.ALLOW_REMOTE_TEST_DB;
  return environment;
}

export function assertNoRemoteSupabaseLink(linked: boolean): void {
  if (linked) throw new Error("phase4_remote_supabase_link_forbidden");
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

function e2e(label: string, file: string, allowRead = false): VerificationStep {
  return denoThroughNpm(label, [
    "test",
    "--allow-env",
    "--allow-net",
    ...(allowRead ? ["--allow-read"] : []),
    file,
  ]);
}

export const phase4VerificationSteps: readonly VerificationStep[] = [
  { ...npmRun("start local Supabase", "db:start", true), suppressStdout: true },
  npmRun("source verification", "verify"),
  reset("database regressions"),
  npmRun("325 pgTAP assertions", "test:db:unit"),
  npmRun("Phase 2 integration regressions", "test:db:integration"),
  npmRun("Phase 2 concurrency regression", "test:db:concurrency"),
  npmRun("Phase 3 database contracts", "test:db:phase3a"),
  npmRun("Phase 2 deletion recovery", "test:db:deletion"),
  npmRun("Phase 4 progression integration", "test:db:phase4a"),
  npmRun("Phase 4 progression concurrency", "test:db:phase4a:concurrency"),
  npmRun("upgrade from migration 013", "test:db:upgrade013", true),
  reset("Phase 3 Telegram E2E"),
  e2e("fallback E2E", "tests/e2e/fallback_solo_test.ts"),
  e2e("restart E2E", "tests/e2e/restart_resume_test.ts"),
  e2e("privacy deletion E2E", "tests/e2e/privacy_deletion_test.ts", true),
  reset("two-day tutorial E2E"),
  e2e("two-day tutorial E2E", "tests/e2e/tutorial_two_day_test.ts"),
  reset("tutorial terminal paths"),
  e2e("tutorial terminal paths", "tests/e2e/tutorial_terminal_paths_test.ts"),
  reset("starter snapshot E2E"),
  e2e("starter snapshot E2E", "tests/e2e/starter_build_snapshot_test.ts"),
  reset("lifecycle E2E"),
  e2e("lifecycle E2E", "tests/e2e/grace_expiry_test.ts"),
  reset("delivery fault E2E"),
  e2e("delivery fault E2E", "tests/e2e/outbox_faults_test.ts"),
  reset("6000 callback load"),
  npmRun("6000 callback load", "load:callbacks"),
  npmRun("starter ring balance matrix", "simulate:starter"),
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

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyLockedBaseline(): Promise<void> {
  for (const [path, expected] of Object.entries(LOCKED_BASELINE)) {
    const actual = toHex(await crypto.subtle.digest("SHA-256", await Deno.readFile(path)));
    if (actual !== expected) throw new Error(`phase4_locked_baseline_drift:${path}`);
  }
}

function pathText(parts: readonly string[]): string {
  return parts.join(".");
}

export function assertSyntheticFixtureSafety(
  fixturePath: string,
  value: unknown,
  parts: readonly string[] = [],
): void {
  if (typeof value === "string") {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error(`phase4_fixture_secret_detected:${fixturePath}:${pathText(parts)}`);
    }
    if (
      fixturePath.includes("/telegram/") && parts.at(-1) === "id" &&
      parts.at(-2) === "callback_query" && !value.startsWith("synthetic-")
    ) {
      throw new Error(`phase4_non_synthetic_identity:${fixturePath}:${pathText(parts)}`);
    }
    return;
  }
  if (typeof value === "number") {
    if (
      fixturePath.includes("/telegram/") && parts.at(-1) === "id" &&
      (parts.at(-2) === "from" || parts.at(-2) === "chat") &&
      (value < SYNTHETIC_TELEGRAM_ID_MIN || value > SYNTHETIC_TELEGRAM_ID_MAX)
    ) {
      throw new Error(`phase4_non_synthetic_identity:${fixturePath}:${pathText(parts)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSyntheticFixtureSafety(fixturePath, entry, [...parts, String(index)])
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_FIXTURE_FIELDS.has(key.toLowerCase())) {
      throw new Error(`phase4_fixture_pii_detected:${fixturePath}:${pathText([...parts, key])}`);
    }
    assertSyntheticFixtureSafety(fixturePath, entry, [...parts, key]);
  }
}

async function jsonFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) files.push(...await jsonFiles(path));
    else if (entry.isFile && entry.name.endsWith(".json")) files.push(path);
  }
  return files.sort();
}

export async function verifySyntheticFixtureSafety(): Promise<void> {
  const files = [
    ...await jsonFiles("content/fallback"),
    ...await jsonFiles("tests/fixtures"),
  ];
  for (const path of files) {
    assertSyntheticFixtureSafety(path, JSON.parse(await Deno.readTextFile(path)));
  }
}

export async function verifyLocalPreflight(): Promise<void> {
  await verifyLockedBaseline();
  await verifySyntheticFixtureSafety();
}

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
    throw new Error(`phase4_verification_failed:${step.label}:${status.code}`);
  }
}

export async function executePhase4Verification(
  runtime: Phase4VerifierRuntime,
  inheritedEnvironment: Readonly<Record<string, string>>,
): Promise<void> {
  assertNoRemoteSupabaseLink(await runtime.hasRemoteLink());
  await runtime.verifyLocalPreflight();
  const environment = localVerificationEnvironment(inheritedEnvironment);
  const profile = await runtime.makeProfile();
  const isolatedEnvironment = {
    ...environment,
    DO_NOT_TRACK: "1",
    SUPABASE_TELEMETRY_DISABLED: "1",
    HOME: profile,
    USERPROFILE: profile,
  };
  let failure: unknown;
  let stackAttempted = false;
  try {
    for (const [index, step] of phase4VerificationSteps.entries()) {
      console.log(`[phase4a ${index + 1}/${phase4VerificationSteps.length}] ${step.label}`);
      if (step.label === "start local Supabase") stackAttempted = true;
      await runtime.runStep(step, environment, isolatedEnvironment);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (stackAttempted) {
      console.log("[phase4a cleanup] stop local Supabase");
      try {
        await runtime.runStep(stopLocalSupabase, environment, isolatedEnvironment);
      } catch (error) {
        failure ??= error;
      }
    }
    await runtime.removeProfile(profile).catch(() => undefined);
  }
  if (failure) throw failure;
}

const runtime: Phase4VerifierRuntime = {
  hasRemoteLink: () => pathExists("supabase/.temp/project-ref"),
  makeProfile: () => Deno.makeTempDir({ prefix: "tggame-phase4a-verify-" }),
  removeProfile: (path) => Deno.remove(path, { recursive: true }),
  runStep,
  verifyLocalPreflight,
};

if (import.meta.main) await executePhase4Verification(runtime, Deno.env.toObject());
