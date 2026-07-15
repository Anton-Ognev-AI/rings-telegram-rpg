import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import type { IdentityDeletionSink } from "../../supabase/functions/_shared/application/delete-identity.ts";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import { RecordingTelegramPort } from "../../supabase/functions/_shared/telegram/fake.ts";
import { deriveDeletionCallbackToken } from "../../supabase/functions/_shared/telegram/deletion-callback.ts";
import {
  handleTelegramUpdate,
  type TelegramHandlerDependencies,
} from "../../supabase/functions/_shared/telegram/handler.ts";
import type {
  NormalizedCallbackUpdate,
  NormalizedCommandUpdate,
} from "../../supabase/functions/_shared/telegram/update.ts";

class ScriptedDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  constructor(
    private readonly responses: Readonly<Record<string, readonly unknown[]>>,
    private readonly events: string[] = [],
  ) {}

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    this.events.push(`db:${rpc}`);
    const queue = this.responses[rpc];
    const index = this.calls.filter((call) => call.rpc === rpc).length - 1;
    if (!queue || index >= queue.length) throw new Error(`unexpected_rpc:${rpc}`);
    const response = queue[index];
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response as T);
  }
}

class EventTelegram extends RecordingTelegramPort {
  constructor(private readonly events: string[]) {
    super();
  }

  override answerCallback(input: Parameters<RecordingTelegramPort["answerCallback"]>[0]) {
    this.events.push("telegram:answer");
    return super.answerCallback(input);
  }

  override sendMessage(input: Parameters<RecordingTelegramPort["sendMessage"]>[0]) {
    this.events.push("telegram:send");
    return super.sendMessage(input);
  }
}

class FailingAnswerTelegram extends RecordingTelegramPort {
  override answerCallback(): Promise<void> {
    return Promise.reject(new Error("telegram_ack_unreachable"));
  }
}

class EventSink implements IdentityDeletionSink {
  readonly tombstones: Array<{
    readonly surrogatePlayerId: string;
    readonly deletionId: string;
    readonly recordedAt: string;
  }> = [];

  constructor(private readonly events: string[]) {}

  recordTombstone(input: (typeof this.tombstones)[number]): Promise<void> {
    this.events.push("sink:tombstone");
    this.tombstones.push(input);
    return Promise.resolve();
  }
}

const playerId = "10000000-0000-4000-8000-000000000001";
const callbackKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const identity = {
  status: "ok",
  created: false,
  playerId,
  stats: {
    physical: 5,
    magical: 6,
    agility: 7,
    vitality: 8,
    defense: 9,
    maxHp: 40,
  },
  xpBalance: 0,
};
const baseBuild = {
  selfSnapshot: {
    maxHp: 40,
    physical: 5,
    magical: 5,
    agility: 5,
    vitality: 5,
    defense: 5,
    vampRateBps: 0,
    postHeal: 0,
  },
  loadoutSnapshot: { progressionConfig: "progression-v1", items: [], rings: [] },
  breakdown: {
    physical: [{
      source: "base",
      label: "Базова фізична сила",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    magical: [{
      source: "base",
      label: "Базова магічна сила",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    agility: [{
      source: "base",
      label: "Базова спритність",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    vitality: [{
      source: "base",
      label: "Базова живучість",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    defense: [{
      source: "base",
      label: "Базовий захист",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    maxHp: [{
      source: "base",
      label: "Базовий максимум HP",
      operation: "add",
      amount: 40,
      result: 40,
      bps: null,
    }],
    postHeal: [],
  },
};
const training = {
  masteryCostXp: 20,
  options: [
    {
      stat: "physical",
      current: 5,
      next: 6,
      cost: 20,
      statDelta: 1,
      maxHpDelta: 0,
      defenseDelta: 0,
    },
    {
      stat: "magical",
      current: 5,
      next: 6,
      cost: 20,
      statDelta: 1,
      maxHpDelta: 0,
      defenseDelta: 0,
    },
    {
      stat: "agility",
      current: 5,
      next: 6,
      cost: 20,
      statDelta: 1,
      maxHpDelta: 0,
      defenseDelta: 0,
    },
    {
      stat: "vitality",
      current: 5,
      next: 6,
      cost: 20,
      statDelta: 1,
      maxHpDelta: 4,
      defenseDelta: 0,
    },
  ],
};
function home(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    status: "ok",
    playerId,
    profileVersion: 0,
    tutorialCompleted: 0,
    rank: "student",
    initialTrainingResolved: false,
    freeXp: 0,
    pendingOffer: null,
    activeRunId: null,
    lastTerminalRunId: null,
    personalBestStage: null,
    training,
    build: baseBuild,
    ...overrides,
  };
}
const deletionIdentity = {
  status: "ok",
  playerId,
  deletionState: "active",
  deletionId: null,
  deletionRequestedAt: null,
};
const commandBase = {
  kind: "command" as const,
  updateId: 101n,
  telegramExternalId: 700000001n,
  chatId: 700000001n,
  messageId: 10n,
  argument: "",
};
const callbackBase: NormalizedCallbackUpdate = {
  kind: "callback",
  updateId: 102n,
  telegramExternalId: 700000001n,
  chatId: 700000001n,
  messageId: 11n,
  callbackQueryId: "callback-1",
  data: "nav:expedition",
};

function dependencies(
  database: DatabasePort,
  telegram = new RecordingTelegramPort(),
  sink: IdentityDeletionSink = { recordTombstone: () => Promise.resolve() },
  deletionEnabled = true,
): TelegramHandlerDependencies {
  return {
    database,
    telegram,
    clock: new FixedClock("2026-08-25T07:00:00.000Z"),
    deletionSink: sink,
    callbackKey,
    deletionEnabled,
  };
}

Deno.test("/start bootstraps canonical identity and shows guided Academy home", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v2: [identity],
    player_home_v1: [home()],
  });
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram),
    { ...commandBase, command: "start" } satisfies NormalizedCommandUpdate,
  );

  assertEquals(result, { statusCode: 200, route: "home" });
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_identity_v2", "player_home_v1"]);
  assertEquals(database.calls[0].args.p_create_if_missing, true);
  const send = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!send || send.operation !== "sendMessage") throw new Error("missing onboarding");
  assertStringIncludes(send.input.text, "Академії");
});

Deno.test("expedition callback is acknowledged before identity and atomic start", async () => {
  const events: string[] = [];
  const database = new ScriptedDatabase({
    telegram_identity_v2: [identity],
    start_run_v3: [{ status: "applied", projection: { run: { id: "run-1" } } }],
  }, events);
  const telegram = new EventTelegram(events);
  const result = await handleTelegramUpdate(dependencies(database, telegram), callbackBase);

  assertEquals(result.route, "expedition_started");
  assertEquals(events[0], "telegram:answer");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v2",
    "start_run_v3",
  ]);
  const startArgs = database.calls[1].args;
  assertEquals(startArgs, {
    p_player_id: playerId,
    p_at: "2026-08-25T07:00:00.000Z",
  });
});

Deno.test("resume and unknown commands route to a compact safe menu", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v2: [identity, identity],
    player_home_v1: [home({ activeRunId: "run-1" }), home()],
    request_run_render_v2: [{ status: "applied", runId: "run-1", stateVersion: 2 }],
  });
  const telegram = new RecordingTelegramPort();

  assertEquals(
    (await handleTelegramUpdate(
      dependencies(database, telegram),
      { ...commandBase, command: "resume" },
    )).route,
    "run_resumed",
  );
  assertEquals(
    (await handleTelegramUpdate(
      dependencies(database, telegram),
      { ...commandBase, updateId: 103n, command: "unknown" },
    )).route,
    "home",
  );
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v2",
    "player_home_v1",
    "request_run_render_v2",
    "telegram_identity_v2",
    "player_home_v1",
  ]);
  assertEquals(database.calls[2].args, {
    p_player_id: playerId,
    p_run_id: "run-1",
  });
});

Deno.test("choice callbacks acknowledge first and distinguish cached, stale, rejected", async () => {
  for (const status of ["cached", "stale", "rejected"] as const) {
    const events: string[] = [];
    const responses: Record<string, readonly unknown[]> = {
      telegram_identity_v2: [identity],
      resolve_choice_v2: [{
        status,
        reason: status === "rejected" ? "invalid_token" : undefined,
        result: status === "cached" ? { projection: { run: { id: "run-1" } } } : undefined,
      }],
    };
    if (status !== "rejected") {
      responses.player_home_v1 = [home({ activeRunId: "run-1" })];
      responses.request_run_render_v2 = [{ status: "applied" }];
    }
    const database = new ScriptedDatabase(responses, events);
    const telegram = new EventTelegram(events);
    const result = await handleTelegramUpdate(
      dependencies(database, telegram),
      { ...callbackBase, data: "cb_0123456789abcdef0123456789abcdef" },
    );

    assertEquals(events[0], "telegram:answer");
    assertEquals(result.route, `choice_${status}`);
    assertEquals(
      database.calls.map((call) => call.rpc),
      status === "rejected" ? ["telegram_identity_v2", "resolve_choice_v2"] : [
        "telegram_identity_v2",
        "resolve_choice_v2",
        "player_home_v1",
        "request_run_render_v2",
      ],
    );
  }
});

Deno.test("callback acknowledgement failure does not block the durable choice mutation", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v2: [identity],
    resolve_choice_v2: [{ status: "applied" }],
  });
  const result = await handleTelegramUpdate(
    dependencies(database, new FailingAnswerTelegram()),
    { ...callbackBase, data: "cb_0123456789abcdef0123456789abcdef" },
  );

  assertEquals(result.route, "choice_applied");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v2",
    "resolve_choice_v2",
  ]);
});

Deno.test("terminal stale callback repairs the latest owner-bound summary", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v2: [identity],
    resolve_choice_v2: [{ status: "stale" }],
    player_home_v1: [home({ lastTerminalRunId: "terminal-run" })],
    request_run_render_v2: [{ status: "applied" }],
  });
  const result = await handleTelegramUpdate(
    dependencies(database),
    { ...callbackBase, updateId: 104n, data: "cb_0123456789abcdef0123456789abcdef" },
  );

  assertEquals(result.route, "choice_stale");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v2",
    "resolve_choice_v2",
    "player_home_v1",
    "request_run_render_v2",
  ]);
  assertEquals(database.calls[3].args.p_run_id, "terminal-run");
});

Deno.test("expedition never accepts a client or identity-derived build", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v2: [{ ...identity, stats: { ...identity.stats, maxHp: 0 } }],
    start_run_v3: [{ status: "applied", projection: { run: { id: "run-1" } } }],
  });
  const result = await handleTelegramUpdate(
    dependencies(database),
    { ...commandBase, command: "expedition" },
  );

  assertEquals(result.route, "expedition_started");
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_identity_v2", "start_run_v3"]);
  assertEquals(Object.keys(database.calls[1].args).sort(), ["p_at", "p_player_id"]);
});

Deno.test("privacy is always readable and deletion requires explicit confirmation", async () => {
  const privacyDb = new ScriptedDatabase({});
  const privacyTelegram = new RecordingTelegramPort();
  const privacyResult = await handleTelegramUpdate(
    dependencies(privacyDb, privacyTelegram),
    { ...commandBase, command: "privacy" },
  );
  assertEquals(privacyResult.route, "privacy");
  assertEquals(privacyDb.calls, []);
  const privacySend = privacyTelegram.calls[0];
  if (!privacySend || privacySend.operation !== "sendMessage") throw new Error("missing privacy");
  assertStringIncludes(privacySend.input.text, "Telegram ID");

  const promptTelegram = new RecordingTelegramPort();
  const promptDatabase = new ScriptedDatabase({
    telegram_deletion_identity_v1: [deletionIdentity],
  });
  const prompt = await handleTelegramUpdate(
    dependencies(promptDatabase, promptTelegram),
    { ...commandBase, command: "delete_me" },
  );
  assertEquals(prompt.route, "delete_confirmation");
  const promptSend = promptTelegram.calls[0];
  if (!promptSend || promptSend.operation !== "sendMessage") throw new Error("missing prompt");
  const confirmationToken = promptSend.input.buttons?.flat()[0].callbackData;
  if (!confirmationToken) throw new Error("missing confirmation token");
  assertEquals(confirmationToken.startsWith("del_"), true);
  assertEquals(confirmationToken.includes(playerId), false);

  const events: string[] = [];
  const deletionDb = new ScriptedDatabase({
    telegram_deletion_identity_v1: [deletionIdentity],
    begin_identity_deletion_v2: [{ status: "applied" }],
    finalize_identity_deletion_v2: [{ status: "applied" }],
  }, events);
  const deletionTelegram = new EventTelegram(events);
  const sink = new EventSink(events);
  const deleted = await handleTelegramUpdate(
    dependencies(deletionDb, deletionTelegram, sink),
    { ...callbackBase, data: confirmationToken },
  );
  assertEquals(deleted.route, "deleted");
  assertEquals(events.slice(0, 5), [
    "telegram:answer",
    "db:telegram_deletion_identity_v1",
    "db:begin_identity_deletion_v2",
    "sink:tombstone",
    "db:finalize_identity_deletion_v2",
  ]);
  assertEquals(sink.tombstones.length, 1);
});

Deno.test("lost finalize response is reported as deleted after canonical unlink", async () => {
  const token = await deriveDeletionCallbackToken(callbackKey, {
    telegramExternalId: callbackBase.telegramExternalId,
    playerId,
  });
  const database = new ScriptedDatabase({
    telegram_deletion_identity_v1: [deletionIdentity, { status: "none" }],
    begin_identity_deletion_v2: [{ status: "applied" }],
    finalize_identity_deletion_v2: [new Error("synthetic_finalize_response_lost")],
  });
  const telegram = new RecordingTelegramPort();

  const result = await handleTelegramUpdate(
    dependencies(database, telegram),
    { ...callbackBase, data: token },
  );

  assertEquals(result.route, "deleted");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_deletion_identity_v1",
    "begin_identity_deletion_v2",
    "finalize_identity_deletion_v2",
    "telegram_deletion_identity_v1",
  ]);
  const sent = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!sent || sent.operation !== "sendMessage") throw new Error("missing_deletion_success");
  assertStringIncludes(sent.input.text, "Зв’язок із Telegram видалено");
});

Deno.test("rejected or malformed read-after-error remains retryable", async () => {
  const token = await deriveDeletionCallbackToken(callbackKey, {
    telegramExternalId: callbackBase.telegramExternalId,
    playerId,
  });
  for (const latest of [{ status: "rejected", reason: "unavailable" }, { status: "ok" }]) {
    const database = new ScriptedDatabase({
      telegram_deletion_identity_v1: [deletionIdentity, latest, latest],
      begin_identity_deletion_v2: [{ status: "applied" }, { status: "cached" }],
      finalize_identity_deletion_v2: [
        new Error("synthetic_finalize_failure"),
        new Error("synthetic_finalize_failure"),
      ],
    });

    const result = await handleTelegramUpdate(
      dependencies(database),
      { ...callbackBase, data: token },
    );

    assertEquals(result.route, "deletion_retryable");
  }
});

Deno.test("a deletion race retries once while the original identity is still linked", async () => {
  const token = await deriveDeletionCallbackToken(callbackKey, {
    telegramExternalId: callbackBase.telegramExternalId,
    playerId,
  });
  const database = new ScriptedDatabase({
    telegram_deletion_identity_v1: [deletionIdentity, {
      ...deletionIdentity,
      deletionState: "deletion_pending",
    }],
    begin_identity_deletion_v2: [{ status: "applied" }, { status: "cached" }],
    finalize_identity_deletion_v2: [
      new Error("synthetic_concurrent_finalize"),
      { status: "applied" },
    ],
  });

  const result = await handleTelegramUpdate(
    dependencies(database),
    { ...callbackBase, data: token },
  );

  assertEquals(result.route, "deleted");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_deletion_identity_v1",
    "begin_identity_deletion_v2",
    "finalize_identity_deletion_v2",
    "telegram_deletion_identity_v1",
    "begin_identity_deletion_v2",
    "finalize_identity_deletion_v2",
  ]);
});

Deno.test("disabled deletion composition never begins a destructive transition", async () => {
  const database = new ScriptedDatabase({});
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(
      database,
      telegram,
      { recordTombstone: () => Promise.reject(new Error("must_not_run")) },
      false,
    ),
    {
      ...callbackBase,
      data: await deriveDeletionCallbackToken(callbackKey, {
        telegramExternalId: callbackBase.telegramExternalId,
        playerId,
      }),
    },
  );
  assertEquals(result.route, "deletion_unavailable");
  assertEquals(database.calls, []);
});

Deno.test("old deletion confirmation cannot delete a re-registered player", async () => {
  const oldToken = await deriveDeletionCallbackToken(callbackKey, {
    telegramExternalId: callbackBase.telegramExternalId,
    playerId,
  });
  const newPlayerId = "10000000-0000-4000-8000-000000000002";
  const database = new ScriptedDatabase({
    telegram_deletion_identity_v1: [{
      ...deletionIdentity,
      playerId: newPlayerId,
    }],
  });
  const result = await handleTelegramUpdate(
    dependencies(database),
    { ...callbackBase, data: oldToken },
  );

  assertEquals(result.route, "deletion_rejected");
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_deletion_identity_v1"]);
});

Deno.test("legacy static deletion confirmation is rejected without identity bootstrap", async () => {
  const database = new ScriptedDatabase({});
  const result = await handleTelegramUpdate(
    dependencies(database),
    { ...callbackBase, data: "nav:delete-confirm" },
  );

  assertEquals(result.route, "deletion_rejected");
  assertEquals(database.calls, []);
});

Deno.test("sink failure keeps confirmation retryable and never finalizes early", async () => {
  const token = await deriveDeletionCallbackToken(callbackKey, {
    telegramExternalId: callbackBase.telegramExternalId,
    playerId,
  });
  const database = new ScriptedDatabase({
    telegram_deletion_identity_v1: [deletionIdentity, deletionIdentity, deletionIdentity],
    begin_identity_deletion_v2: [{ status: "applied" }, { status: "cached" }],
  });
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram, {
      recordTombstone: () => Promise.reject(new Error("synthetic_sink_failure")),
    }),
    { ...callbackBase, data: token },
  );

  assertEquals(result.route, "deletion_retryable");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_deletion_identity_v1",
    "begin_identity_deletion_v2",
    "telegram_deletion_identity_v1",
    "begin_identity_deletion_v2",
    "telegram_deletion_identity_v1",
  ]);
  const send = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!send || send.operation !== "sendMessage") throw new Error("missing retry card");
  assertStringIncludes(send.input.text, "не завершено");
  assertEquals(send.input.buttons?.flat()[0].callbackData, token);
});

Deno.test("/start exposes a blocked pending deletion instead of onboarding", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v2: [{ status: "rejected", reason: "identity_deletion_pending" }],
  });
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram),
    { ...commandBase, command: "start" },
  );

  assertEquals(result.route, "identity_pending");
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_identity_v2"]);
  const send = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!send || send.operation !== "sendMessage") throw new Error("missing pending card");
  assertStringIncludes(send.input.text, "Видалення");
  assertStringIncludes(send.input.text, "/delete_me");
});
