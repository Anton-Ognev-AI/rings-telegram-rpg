import {
  defaultOwnerSmokePreflightDependencies,
  type OwnerSmokePreflightResult,
  preflightOwnerSmoke,
} from "./preflight-owner-smoke.ts";
import { parseStagingCliArgs, type StagingCliOptions } from "./project-policy.ts";

const ANON_KEY = "STAGING_SUPABASE_ANON_KEY";
const INTERNAL_SECRET = "INTERNAL_FUNCTION_SECRET";
const POLL_INTERVAL_MS = 2_000;

interface WorkerTotals {
  readonly leased: number;
  readonly sent: number;
  readonly retried: number;
  readonly dead: number;
  readonly deliveryUnknown: number;
  readonly superseded: number;
}

export interface OwnerSmokeRunnerResult {
  readonly status: "ready" | "stopped";
  readonly mode: "dry-run" | "remote";
  readonly dayCalls: number;
  readonly workerPolls: number;
  readonly totals: WorkerTotals;
}

export interface OwnerSmokeRunnerDependencies {
  readonly preflight: (options: StagingCliOptions) => Promise<OwnerSmokePreflightResult>;
  readonly getEnvironment: (name: string) => string | undefined;
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly isCancelled: () => boolean;
}

function zeroTotals(): WorkerTotals {
  return { leased: 0, sent: 0, retried: 0, dead: 0, deliveryUnknown: 0, superseded: 0 };
}

function requiredEnvironment(
  dependencies: OwnerSmokeRunnerDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironment(name);
  if (!value) throw new Error("owner_smoke_missing_remote_configuration");
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workerTotals(value: unknown): WorkerTotals {
  if (!isRecord(value) || value.status !== "ok") {
    throw new Error("owner_smoke_remote_response_invalid");
  }
  const names = ["leased", "sent", "retried", "dead", "deliveryUnknown", "superseded"] as const;
  const result = {} as Record<(typeof names)[number], number>;
  for (const name of names) {
    const count = value[name];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("owner_smoke_remote_response_invalid");
    }
    result[name] = count;
  }
  return result;
}

function addTotals(left: WorkerTotals, right: WorkerTotals): WorkerTotals {
  return {
    leased: left.leased + right.leased,
    sent: left.sent + right.sent,
    retried: left.retried + right.retried,
    dead: left.dead + right.dead,
    deliveryUnknown: left.deliveryUnknown + right.deliveryUnknown,
    superseded: left.superseded + right.superseded,
  };
}

async function post(
  dependencies: OwnerSmokeRunnerDependencies,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await dependencies.fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("owner_smoke_remote_request_failed");
  }
  if (!response.ok) throw new Error("owner_smoke_remote_request_failed");
  try {
    return await response.json();
  } catch {
    throw new Error("owner_smoke_remote_response_invalid");
  }
}

export async function runOwnerSmoke(
  options: StagingCliOptions,
  dependencies: OwnerSmokeRunnerDependencies,
): Promise<OwnerSmokeRunnerResult> {
  const preflight = await dependencies.preflight(options);
  if (!options.executeRemote) {
    if (preflight.mode !== "dry-run") throw new Error("owner_smoke_preflight_mode_mismatch");
    return { status: "ready", mode: "dry-run", dayCalls: 0, workerPolls: 0, totals: zeroTotals() };
  }
  if (preflight.mode !== "remote") throw new Error("owner_smoke_preflight_mode_mismatch");

  const anonKey = requiredEnvironment(dependencies, ANON_KEY);
  const internalSecret = requiredEnvironment(dependencies, INTERNAL_SECRET);
  const headers = {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
    "X-TgGame-Internal-Secret": internalSecret,
  };
  const baseUrl = `https://${options.projectRef}.supabase.co/functions/v1`;
  const day = await post(dependencies, `${baseUrl}/day-publish-reset`, headers);
  if (!isRecord(day) || day.status !== "ok") {
    throw new Error("owner_smoke_remote_response_invalid");
  }

  let workerPolls = 0;
  let totals = zeroTotals();
  while (!dependencies.isCancelled()) {
    totals = addTotals(
      totals,
      workerTotals(await post(dependencies, `${baseUrl}/outbox-worker`, headers)),
    );
    workerPolls += 1;
    if (!dependencies.isCancelled()) await dependencies.sleep(POLL_INTERVAL_MS);
  }
  return { status: "stopped", mode: "remote", dayCalls: 1, workerPolls, totals };
}

function defaultDependencies(isCancelled: () => boolean): OwnerSmokeRunnerDependencies {
  return {
    preflight: (options) => preflightOwnerSmoke(options, defaultOwnerSmokePreflightDependencies),
    getEnvironment: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    isCancelled,
  };
}

async function main(): Promise<void> {
  let cancelled = false;
  const cancel = () => cancelled = true;
  Deno.addSignalListener("SIGINT", cancel);
  try {
    const result = await runOwnerSmoke(
      parseStagingCliArgs(Deno.args),
      defaultDependencies(() => cancelled),
    );
    console.log(JSON.stringify(result));
  } catch {
    console.error(JSON.stringify({ status: "rejected" }));
    Deno.exitCode = 1;
  } finally {
    Deno.removeSignalListener("SIGINT", cancel);
  }
}

if (import.meta.main) await main();
