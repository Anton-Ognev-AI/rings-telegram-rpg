import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.19";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type {
  CommandResult,
  DatabasePort,
} from "../../supabase/functions/_shared/application/database-port.ts";
import {
  processOutboxBatch,
  type ProcessOutboxDependencies,
} from "../../supabase/functions/_shared/application/process-outbox.ts";
import type { TelegramRunView } from "../../supabase/functions/_shared/application/prepare-run-card.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import { RecordingTelegramPort } from "../../supabase/functions/_shared/telegram/fake.ts";

const fallback = fallbackJson as DungeonContentV1;
const fixedTime = "2026-08-25T07:00:00.000Z";

function runView(
  stateVersion = 4,
  cardMessageId: string | null = null,
  lastCardStateVersion = 3,
): TelegramRunView {
  return {
    status: "ok",
    run: {
      id: "20000000-0000-4000-8000-000000000001",
      playerId: "10000000-0000-4000-8000-000000000001",
      cycleId: "2026-08-25",
      status: "active",
      phase: "awaiting_choice",
      stateVersion,
      stage: 1,
      exchange: null,
      hp: 100,
      maxHp: 100,
      bossHp: null,
      xpEarned: 0,
    },
    selfSnapshot: {
      maxHp: 100,
      physical: 70,
      magical: 70,
      agility: 70,
      vitality: 70,
      defense: 0,
      vampRateBps: 0,
      postHeal: 0,
    },
    loadout: { partyMode: "solo", companion: null, items: [], rings: [] },
    content: fallback,
    cycle: {
      cycleId: "2026-08-25",
      opensAt: "2026-08-25T06:00:00.000Z",
      closesAt: "2026-08-26T06:00:00.000Z",
      graceEndsAt: "2026-08-26T08:00:00.000Z",
      status: "open",
    },
    lastResolution: null,
    card: cardMessageId === null
      ? null
      : { messageId: cardMessageId, lastStateVersion: lastCardStateVersion },
  };
}

function leasedMessage(
  cardMessageId: string | null = null,
  stateVersion = 4,
  intentType = "render_run_state",
) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    leaseId: "40000000-0000-4000-8000-000000000001",
    intentType,
    payload: {
      runId: "20000000-0000-4000-8000-000000000001",
      stateVersion,
    },
    attempts: 1,
    playerId: "10000000-0000-4000-8000-000000000001",
    cardMessageId,
  };
}

class WorkerDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  constructor(
    private readonly message: ReturnType<typeof leasedMessage>,
    private readonly view: TelegramRunView | CommandResult,
    private readonly authorization: Readonly<Record<string, unknown>> = {
      status: "ok",
      telegramExternalId: "700000001",
      deliveryDeadline: "2026-08-25T07:00:30.000Z",
    },
    private readonly completionResult: CommandResult = { status: "applied" },
  ) {}

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    if (rpc === "lease_outbox_v3") {
      return Promise.resolve({ status: "ok", messages: [this.message] } as T);
    }
    if (rpc === "run_view_v2") return Promise.resolve(this.view as T);
    if (rpc === "prepare_action_v2") return Promise.resolve({ status: "ok" } as T);
    if (rpc === "authorize_outbox_delivery_v2") {
      return Promise.resolve(this.authorization as T);
    }
    if (rpc === "complete_outbox_v1") return Promise.resolve(this.completionResult as T);
    throw new Error(`unexpected_rpc:${rpc}`);
  }
}

function deps(database: DatabasePort, telegram: RecordingTelegramPort): ProcessOutboxDependencies {
  return {
    database,
    telegram,
    clock: new FixedClock(fixedTime),
    callbackKey: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
  };
}

function completion(database: WorkerDatabase): Readonly<Record<string, unknown>> {
  const call = database.calls.findLast((candidate) => candidate.rpc === "complete_outbox_v1");
  if (!call) throw new Error("missing_completion");
  return call.args;
}

Deno.test("outbox worker sends the first canonical card and completes its lease", async () => {
  const database = new WorkerDatabase(leasedMessage(), runView());
  const telegram = new RecordingTelegramPort([{ kind: "success", messageId: 8123n }]);
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 10,
    leaseSeconds: 30,
  });

  assertEquals(result, {
    leased: 1,
    sent: 1,
    retried: 0,
    dead: 0,
    deliveryUnknown: 0,
    superseded: 0,
  });
  assertEquals(telegram.calls[0].operation, "sendMessage");
  if (telegram.calls[0].operation !== "sendMessage") throw new Error("missing_send");
  assertEquals(telegram.calls[0].input.timeoutMs, 10_000);
  const authorization = database.calls.find((call) => call.rpc === "authorize_outbox_delivery_v2");
  assertEquals(authorization?.args.p_is_new_send, true);
  assertEquals(authorization?.args.p_transport_seconds, 15);
  assertEquals(completion(database).p_result, "sent");
  assertEquals(completion(database).p_telegram_message_id, "8123");
  assertEquals(database.calls.filter((call) => call.rpc === "prepare_action_v2").length, 3);
});

Deno.test("outbox worker edits the existing run card", async () => {
  const database = new WorkerDatabase(leasedMessage("9001"), runView(4, "9001"));
  const telegram = new RecordingTelegramPort();
  await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(telegram.calls[0].operation, "editMessage");
  const authorization = database.calls.find((call) => call.rpc === "authorize_outbox_delivery_v2");
  assertEquals(authorization?.args.p_is_new_send, false);
  assertEquals(completion(database).p_result, "sent");
  assertEquals(completion(database).p_telegram_message_id, "9001");
});

Deno.test("repair intent edits a same-version canonical card instead of being superseded", async () => {
  const database = new WorkerDatabase(
    leasedMessage("9001", 4, "repair_run_state"),
    runView(4, "9001", 4),
  );
  const telegram = new RecordingTelegramPort();
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(result.sent, 1);
  assertEquals(telegram.calls[0].operation, "editMessage");
  assertEquals(completion(database).p_result, "sent");
});

Deno.test("repair intent without a known card is dead and never blind-sends", async () => {
  const database = new WorkerDatabase(
    leasedMessage(null, 4, "repair_run_state"),
    runView(4),
  );
  const telegram = new RecordingTelegramPort();
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(result.dead, 1);
  assertEquals(telegram.calls, []);
  assertEquals(completion(database).p_result, "dead");
});

Deno.test("outbox worker supersedes an intent older than canonical state", async () => {
  const database = new WorkerDatabase(leasedMessage(null, 4), runView(5));
  const telegram = new RecordingTelegramPort();
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(result.superseded, 1);
  assertEquals(telegram.calls, []);
  assertEquals(completion(database).p_result, "superseded");
});

Deno.test("outbox worker classifies retryable, permanent, and unknown send results", async () => {
  for (
    const sample of [
      { kind: "retryable" as const, expected: "retry" },
      { kind: "permanent" as const, expected: "dead" },
      { kind: "delivery_unknown" as const, expected: "delivery_unknown" },
    ]
  ) {
    const database = new WorkerDatabase(leasedMessage(), runView());
    const telegram = new RecordingTelegramPort([{ kind: sample.kind, retryAfterSeconds: 7 }]);
    await processOutboxBatch(deps(database, telegram), {
      workerId: "50000000-0000-4000-8000-000000000001",
      limit: 1,
      leaseSeconds: 30,
    });
    const complete = completion(database);
    assertEquals(complete.p_result, sample.expected);
    if (sample.expected === "retry") {
      assertMatch(String(complete.p_retry_at), /^2026-08-25T07:00:07\.000Z$/u);
    } else assertEquals(complete.p_retry_at, null);
  }
});

Deno.test("delivery-unknown edit is retried because edit cannot create a second card", async () => {
  const database = new WorkerDatabase(leasedMessage("9001"), runView(4, "9001"));
  const telegram = new RecordingTelegramPort([{ kind: "delivery_unknown" }]);
  await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });
  assertEquals(completion(database).p_result, "retry");
  assertMatch(String(completion(database).p_retry_at), /^2026-08-25T07:00:/u);
});

Deno.test("leased work for a deletion-pending player is superseded without Telegram", async () => {
  const database = new WorkerDatabase(leasedMessage(), {
    status: "rejected",
    reason: "inactive_player",
  });
  const telegram = new RecordingTelegramPort();
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(result.superseded, 1);
  assertEquals(telegram.calls, []);
  assertEquals(completion(database).p_result, "superseded");
});

Deno.test("delivery authorization revoked by deletion is superseded without Telegram", async () => {
  const database = new WorkerDatabase(
    leasedMessage(),
    runView(),
    { status: "superseded" },
  );
  const telegram = new RecordingTelegramPort();
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(result.superseded, 1);
  assertEquals(telegram.calls, []);
  assertEquals(
    database.calls.filter((call) => call.rpc === "authorize_outbox_delivery_v2").length,
    1,
  );
});

Deno.test("the tenth retry is reported as dead when the database exhausts its budget", async () => {
  const message = { ...leasedMessage(), attempts: 10 };
  const database = new WorkerDatabase(
    message,
    runView(),
    {
      status: "ok",
      telegramExternalId: "700000001",
      deliveryDeadline: "2026-08-25T07:00:30.000Z",
    },
    { status: "applied", outboxStatus: "dead" },
  );
  const telegram = new RecordingTelegramPort([{ kind: "retryable" }]);
  const result = await processOutboxBatch(deps(database, telegram), {
    workerId: "50000000-0000-4000-8000-000000000001",
    limit: 1,
    leaseSeconds: 30,
  });

  assertEquals(result.dead, 1);
  assertEquals(result.retried, 0);
  assertEquals(completion(database).p_result, "retry");
});
