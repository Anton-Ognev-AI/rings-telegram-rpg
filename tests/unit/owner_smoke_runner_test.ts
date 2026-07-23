import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  type OwnerSmokeRunnerDependencies,
  runOwnerSmoke,
} from "../../scripts/staging/run-owner-smoke.ts";

const options = {
  staging: true,
  projectRef: "aaaaaaaaaaaaaaaaaaaa",
  recoveryProjectRef: "bbbbbbbbbbbbbbbbbbbb",
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

Deno.test("owner-smoke runner is a zero-network dry-run by default", async () => {
  let fetches = 0;
  const dependencies: OwnerSmokeRunnerDependencies = {
    preflight: () =>
      Promise.resolve({
        status: "ready",
        mode: "dry-run",
        checks: 7,
        migrationsVerified: 3,
        trackedFilesScanned: 6,
      }),
    getEnvironment: () => {
      throw new Error("dry_run_secret_read");
    },
    fetch: () => {
      fetches += 1;
      return Promise.resolve(response({ status: "unexpected" }));
    },
    sleep: () => Promise.resolve(),
    isCancelled: () => false,
  };
  const result = await runOwnerSmoke({ ...options, executeRemote: false }, dependencies);
  assertEquals(result, {
    status: "ready",
    mode: "dry-run",
    dayCalls: 0,
    workerPolls: 0,
    totals: { leased: 0, sent: 0, retried: 0, dead: 0, deliveryUnknown: 0, superseded: 0 },
  });
  assertEquals(fetches, 0);
});

Deno.test("remote owner-smoke publishes once and polls only after explicit execution", async () => {
  let dayCalls = 0;
  let workerCalls = 0;
  const sleeps: number[] = [];
  const dependencies: OwnerSmokeRunnerDependencies = {
    preflight: () =>
      Promise.resolve({
        status: "ready",
        mode: "remote",
        checks: 7,
        migrationsVerified: 3,
        trackedFilesScanned: 6,
      }),
    getEnvironment(name) {
      if (name === "STAGING_SUPABASE_ANON_KEY") return "synthetic-anon-key";
      if (name === "INTERNAL_FUNCTION_SECRET") return "synthetic-internal-secret";
      return undefined;
    },
    fetch: (url, init) => {
      assertEquals(
        String(url).startsWith("https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/"),
        true,
      );
      assertEquals(
        (init?.headers as Record<string, string>)["X-TgGame-Internal-Secret"],
        "synthetic-internal-secret",
      );
      if (String(url).endsWith("/day-publish-reset")) {
        dayCalls += 1;
        return Promise.resolve(response({ status: "ok" }));
      }
      workerCalls += 1;
      return Promise.resolve(response({
        status: "ok",
        leased: 1,
        sent: 1,
        retried: 0,
        dead: 0,
        deliveryUnknown: 0,
        superseded: 0,
      }));
    },
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    },
    isCancelled: () => workerCalls >= 3,
  };
  const result = await runOwnerSmoke({ ...options, executeRemote: true }, dependencies);
  assertEquals(dayCalls, 1);
  assertEquals(workerCalls, 3);
  assertEquals(sleeps, [2000, 2000]);
  assertEquals(result, {
    status: "stopped",
    mode: "remote",
    dayCalls: 1,
    workerPolls: 3,
    totals: { leased: 3, sent: 3, retried: 0, dead: 0, deliveryUnknown: 0, superseded: 0 },
  });
});

Deno.test("remote owner-smoke survives one transient worker failure", async () => {
  let dayCalls = 0;
  let workerCalls = 0;
  const sleeps: number[] = [];
  const dependencies: OwnerSmokeRunnerDependencies = {
    preflight: () =>
      Promise.resolve({
        status: "ready",
        mode: "remote",
        checks: 7,
        migrationsVerified: 3,
        trackedFilesScanned: 6,
      }),
    getEnvironment(name) {
      if (name === "STAGING_SUPABASE_ANON_KEY") return "synthetic-anon-key";
      if (name === "INTERNAL_FUNCTION_SECRET") return "synthetic-internal-secret";
      return undefined;
    },
    fetch: (url) => {
      if (String(url).endsWith("/day-publish-reset")) {
        dayCalls += 1;
        return Promise.resolve(response({ status: "ok" }));
      }
      workerCalls += 1;
      if (workerCalls === 1) {
        return Promise.resolve(response({ status: "temporary" }, 500));
      }
      return Promise.resolve(response({
        status: "ok",
        leased: 0,
        sent: 0,
        retried: 0,
        dead: 0,
        deliveryUnknown: 0,
        superseded: 0,
      }));
    },
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    },
    isCancelled: () => workerCalls >= 3,
  };

  const result = await runOwnerSmoke({ ...options, executeRemote: true }, dependencies);

  assertEquals(dayCalls, 1);
  assertEquals(workerCalls, 3);
  assertEquals(sleeps, [2000, 2000]);
  assertEquals(result.workerPolls, 2);
});

Deno.test("remote owner-smoke returns a generic failure on auth or response mismatch", async () => {
  const secret = "synthetic-internal-secret";
  const dependencies: OwnerSmokeRunnerDependencies = {
    preflight: () =>
      Promise.resolve({
        status: "ready",
        mode: "remote",
        checks: 7,
        migrationsVerified: 3,
        trackedFilesScanned: 6,
      }),
    getEnvironment: (name) => name === "STAGING_SUPABASE_ANON_KEY" ? "synthetic-anon" : secret,
    fetch: () => Promise.resolve(response({ status: "unauthorized", detail: secret }, 401)),
    sleep: () => Promise.resolve(),
    isCancelled: () => false,
  };
  const error = await assertRejects(
    () => runOwnerSmoke({ ...options, executeRemote: true }, dependencies),
    Error,
    "owner_smoke_remote_request_failed",
  );
  assertEquals(error.message.includes(secret), false);
});
