import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import type { Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import { processOutboxBatch } from "../../supabase/functions/_shared/application/process-outbox.ts";
import { requestRunRender } from "../../supabase/functions/_shared/application/request-run-render.ts";
import { resumeRun } from "../../supabase/functions/_shared/application/resume.ts";
import { getRunView } from "../../supabase/functions/_shared/application/run-view.ts";
import { startTelegramRun } from "../../supabase/functions/_shared/application/start-telegram-run.ts";
import { getTelegramIdentity } from "../../supabase/functions/_shared/application/telegram-identity.ts";
import {
  canonicalJson,
  sha256Hex,
} from "../../supabase/functions/_shared/domain/canonical-json.ts";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import type { FetchPort } from "../../supabase/functions/_shared/infrastructure/supabase-rpc.ts";
import {
  TelegramBotApiPort,
  TelegramTransportError,
} from "../../supabase/functions/_shared/telegram/http.ts";
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";
import { CALLBACK_KEY } from "./helpers/telegram-flow.ts";

const opensAt = "2026-12-03T07:00:00.000Z";
const snapshot = {
  maxHp: 100,
  physical: 70,
  magical: 70,
  agility: 70,
  vitality: 70,
  defense: 0,
  vampRateBps: 0,
  postHeal: 0,
};
const loadout = { partyMode: "solo", companion: null, items: [], rings: [] };

type FaultMode = "success" | "429" | "500" | "before_dispatch" | "unknown" | "permanent";

function telegram(
  mode: FaultMode,
  calls: Array<{ url: string; body: Readonly<Record<string, unknown>> }>,
  messageId: number,
): TelegramBotApiPort {
  const fetcher: FetchPort = (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    switch (mode) {
      case "success":
        return Promise.resolve(Response.json({ ok: true, result: { message_id: messageId } }));
      case "429":
        return Promise.resolve(Response.json({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 9 },
        }, { status: 429 }));
      case "500":
        return Promise.resolve(
          Response.json({ ok: false, error_code: 500 }, { status: 500 }),
        );
      case "before_dispatch":
        return Promise.reject(new TelegramTransportError("before_dispatch"));
      case "unknown":
        return Promise.reject(new TypeError("synthetic_response_lost"));
      case "permanent":
        return Promise.resolve(
          Response.json({ ok: false, error_code: 400 }, { status: 400 }),
        );
    }
  };
  return new TelegramBotApiPort("123456:synthetic-local-token", fetcher);
}

async function startScenario(
  database: PostgresRpcDatabase,
  externalId: bigint,
): Promise<{ playerId: string; runId: string }> {
  const identity = await getTelegramIdentity(database, {
    telegramExternalId: externalId,
    create: true,
  });
  const playerId = String(identity.playerId);
  const started = await startTelegramRun(database, {
    playerId,
    at: opensAt,
    selfSnapshot: snapshot,
    selfSnapshotSha256: await sha256Hex(canonicalJson(snapshot)),
    loadoutSnapshot: loadout,
    loadoutSnapshotSha256: await sha256Hex(canonicalJson(loadout)),
  });
  assertEquals(started.status, "applied");
  return {
    playerId,
    runId: String((started.projection as { run: { id: string } }).run.id),
  };
}

async function ensureDay(database: PostgresRpcDatabase): Promise<void> {
  const published = await publishFallbackDay(database, opensAt);
  assertEquals(published.status === "applied" || published.status === "cached", true);
  assertEquals((await advanceDay(database, opensAt)).status, "ok");
}

function atOffset(seconds: number): string {
  return new Date(Date.parse(opensAt) + seconds * 1000).toISOString();
}

async function work(
  database: PostgresRpcDatabase,
  at: string,
  worker: number,
  port: TelegramBotApiPort,
) {
  return await processOutboxBatch({
    database,
    telegram: port,
    clock: new FixedClock(at),
    callbackKey: CALLBACK_KEY,
  }, {
    workerId: `50000000-0000-4000-8000-${String(worker).padStart(12, "0")}`,
    limit: 1,
    leaseSeconds: 30,
  });
}

async function latestOutbox(sql: Sql, runId: string) {
  const [row] = await sql<{
    status: string;
    attempts: number;
    last_error_kind: string | null;
    intent_type: string;
  }[]>`select status::text, attempts, last_error_kind, intent_type
    from game.outbox_messages
    where payload->>'runId' = ${runId}
    order by created_at desc, id desc limit 1`;
  if (!row) throw new Error("missing_outbox_row");
  return row;
}

async function cardCount(sql: Sql, runId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::integer as count
    from game.telegram_run_cards where run_id = ${runId}::uuid`;
  return row?.count ?? -1;
}

async function advanceCanonicalVersionWithoutDelivery(sql: Sql, runId: string): Promise<void> {
  await sql`update game.runs set state_version = state_version + 1
    where id = ${runId}::uuid`;
}

async function assertCanonicalRun(
  database: PostgresRpcDatabase,
  playerId: string,
  runId: string,
  expectedStateVersion = 0,
) {
  const resumed = await resumeRun(database, playerId);
  assertEquals(resumed.status, "ok");
  assertEquals((resumed.run as { id: string; stateVersion: number }).id, runId);
  assertEquals((resumed.run as { stateVersion: number }).stateVersion, expectedStateVersion);
  const view = await getRunView(database, { playerId, runId });
  assertEquals(view.status, "ok");
  assertEquals((view.run as { id: string; stateVersion: number }).id, runId);
  assertEquals((view.run as { stateVersion: number }).stateVersion, expectedStateVersion);
}

Deno.test("retryable Telegram failures recover to one canonical editable card", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    await ensureDay(database);

    for (
      const [index, mode] of (["429", "before_dispatch"] as const).entries()
    ) {
      const scenario = await startScenario(database, 996000000000000000n + BigInt(index));
      const failedCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
      const failed = await work(
        database,
        atOffset(index * 1000 + 10),
        100 + index * 10,
        telegram(mode, failedCalls, 8100 + index),
      );
      assertEquals(failed.retried, 1);
      assertEquals((await latestOutbox(sql, scenario.runId)).status, "pending");
      assertEquals((await latestOutbox(sql, scenario.runId)).last_error_kind, "retryable");

      const successCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
      const recovered = await work(
        database,
        atOffset(index * 1000 + 500),
        101 + index * 10,
        telegram("success", successCalls, 8100 + index),
      );
      assertEquals(recovered.sent, 1);
      assertEquals(await cardCount(sql, scenario.runId), 1);
      await assertCanonicalRun(database, scenario.playerId, scenario.runId);

      await advanceCanonicalVersionWithoutDelivery(sql, scenario.runId);
      const repair = await requestRunRender(database, {
        playerId: scenario.playerId,
        runId: scenario.runId,
      });
      assertEquals(repair.status, "applied");
      const repairCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
      assertEquals(
        (await work(
          database,
          atOffset(index * 1000 + 600),
          102 + index * 10,
          telegram("success", repairCalls, 8100 + index),
        )).sent,
        1,
      );
      assertStringIncludes(repairCalls[0]!.url, "/editMessageText");
      assertEquals(await cardCount(sql, scenario.runId), 1);
    }
  });
});

Deno.test("crash after arming a new send becomes delivery unknown without blind resend", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    await ensureDay(database);
    const scenario = await startScenario(database, 996000000000000099n);
    const leased = await database.call<{
      status: string;
      messages: Array<{ id: string; leaseId: string; payload: { runId: string } }>;
    }>("lease_outbox_v3", {
      p_worker_id: "50000000-0000-4000-8000-000000000199",
      p_limit: 50,
      p_lease_seconds: 30,
      p_at: atOffset(10),
    });
    const message = leased.messages.find((candidate) => candidate.payload.runId === scenario.runId);
    if (!message) throw new Error("missing_crash_lease");
    const authorization = await database.call<{ status: string }>(
      "authorize_outbox_delivery_v2",
      {
        p_outbox_id: message.id,
        p_lease_id: message.leaseId,
        p_is_new_send: true,
        p_transport_seconds: 5,
        p_at: atOffset(11),
      },
    );
    assertEquals(authorization.status, "ok");

    const transportCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
    const reclaimed = await work(
      database,
      atOffset(17),
      199,
      telegram("success", transportCalls, 8199),
    );
    assertEquals(reclaimed.leased, 0);
    assertEquals(transportCalls, []);
    assertEquals((await latestOutbox(sql, scenario.runId)).status, "delivery_unknown");
    assertEquals(await cardCount(sql, scenario.runId), 0);
  });
});

Deno.test("500 retries stop at ten attempts without losing canonical run state", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    await ensureDay(database);
    const scenario = await startScenario(database, 996000000000000010n);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const calls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
      const result = await work(
        database,
        atOffset(20_000 + attempt * 1000),
        200 + attempt,
        telegram("500", calls, 8200),
      );
      assertEquals(calls.length, 1);
      if (attempt < 10) assertEquals(result.retried, 1);
      else assertEquals(result.dead, 1);
    }
    assertEquals(await latestOutbox(sql, scenario.runId), {
      status: "dead",
      attempts: 10,
      last_error_kind: "permanent",
      intent_type: "render_run_state",
    });
    assertEquals(await cardCount(sql, scenario.runId), 0);
    await assertCanonicalRun(database, scenario.playerId, scenario.runId);
    assertEquals(
      (await requestRunRender(database, {
        playerId: scenario.playerId,
        runId: scenario.runId,
      })).reason,
      "card_unavailable",
    );
    const afterBudgetCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
    assertEquals(
      (await work(
        database,
        atOffset(40_000),
        220,
        telegram("success", afterBudgetCalls, 8200),
      )).leased,
      0,
    );
    assertEquals(afterBudgetCalls, []);
  });
});

Deno.test("ambiguous new send and permanent rejection are terminal and never blind-resend", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    await ensureDay(database);
    for (const [index, mode] of (["unknown", "permanent"] as const).entries()) {
      const scenario = await startScenario(database, 996000000000000020n + BigInt(index));
      const firstCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
      const failed = await work(
        database,
        atOffset(50_000 + index * 1000),
        230 + index * 10,
        telegram(mode, firstCalls, 8300 + index),
      );
      assertEquals(mode === "unknown" ? failed.deliveryUnknown : failed.dead, 1);
      assertEquals(
        (await latestOutbox(sql, scenario.runId)).status,
        mode === "unknown" ? "delivery_unknown" : "dead",
      );
      assertEquals(await cardCount(sql, scenario.runId), 0);

      const retryCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
      assertEquals(
        (await work(
          database,
          atOffset(50_500 + index * 1000),
          231 + index * 10,
          telegram("success", retryCalls, 8300 + index),
        )).leased,
        0,
      );
      assertEquals(retryCalls, []);
      await assertCanonicalRun(database, scenario.playerId, scenario.runId);
      assertEquals(
        (await requestRunRender(database, {
          playerId: scenario.playerId,
          runId: scenario.runId,
        })).reason,
        "card_unavailable",
      );
    }
  });
});

Deno.test("an ambiguous edit is safely retried against the same canonical message", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    await ensureDay(database);
    const scenario = await startScenario(database, 996000000000000030n);
    const initialCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
    assertEquals(
      (await work(
        database,
        atOffset(60_000),
        250,
        telegram("success", initialCalls, 8400),
      )).sent,
      1,
    );
    assertStringIncludes(initialCalls[0]!.url, "/sendMessage");

    await advanceCanonicalVersionWithoutDelivery(sql, scenario.runId);
    assertEquals(
      (await requestRunRender(database, {
        playerId: scenario.playerId,
        runId: scenario.runId,
      })).status,
      "applied",
    );
    const faultCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
    const faulted = await work(
      database,
      atOffset(60_100),
      251,
      telegram("unknown", faultCalls, 8400),
    );
    assertEquals(faulted.retried, 1);
    assertStringIncludes(faultCalls[0]!.url, "/editMessageText");
    assertEquals((await latestOutbox(sql, scenario.runId)).status, "pending");

    const recoveredCalls: Array<{ url: string; body: Readonly<Record<string, unknown>> }> = [];
    assertEquals(
      (await work(
        database,
        atOffset(60_500),
        252,
        telegram("success", recoveredCalls, 8400),
      )).sent,
      1,
    );
    assertStringIncludes(recoveredCalls[0]!.url, "/editMessageText");
    assertEquals((recoveredCalls[0]!.body as { message_id: number }).message_id, 8400);
    assertEquals(await cardCount(sql, scenario.runId), 1);
    await assertCanonicalRun(database, scenario.playerId, scenario.runId, 1);
  });
});
