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
    return Promise.resolve(queue[index] as T);
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

Deno.test("/start bootstraps a minimal identity and shows Academy onboarding", async () => {
  const database = new ScriptedDatabase({ telegram_identity_v1: [identity] });
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram),
    { ...commandBase, command: "start" } satisfies NormalizedCommandUpdate,
  );

  assertEquals(result, { statusCode: 200, route: "onboarding" });
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_identity_v1"]);
  assertEquals(database.calls[0].args.p_create_if_missing, true);
  const send = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!send || send.operation !== "sendMessage") throw new Error("missing onboarding");
  assertStringIncludes(send.input.text, "Академії");
});

Deno.test("expedition callback is acknowledged before identity and atomic start", async () => {
  const events: string[] = [];
  const database = new ScriptedDatabase({
    telegram_identity_v1: [identity],
    start_run_v2: [{ status: "applied", projection: { run: { id: "run-1" } } }],
  }, events);
  const telegram = new EventTelegram(events);
  const result = await handleTelegramUpdate(dependencies(database, telegram), callbackBase);

  assertEquals(result.route, "expedition_started");
  assertEquals(events[0], "telegram:answer");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v1",
    "start_run_v2",
  ]);
  const startArgs = database.calls[1].args;
  assertEquals(startArgs.p_at, "2026-08-25T07:00:00.000Z");
  assertEquals(startArgs.p_self_snapshot, {
    physical: 5,
    magical: 6,
    agility: 7,
    vitality: 8,
    defense: 9,
    maxHp: 40,
    vampRateBps: 0,
    postHeal: 0,
  });
  assertEquals(startArgs.p_loadout_snapshot, {
    partyMode: "solo",
    companion: null,
    items: [],
    rings: [],
  });
  assertEquals(typeof startArgs.p_self_snapshot_sha256, "string");
  assertEquals((startArgs.p_self_snapshot_sha256 as string).length, 64);
});

Deno.test("resume and unknown commands route to a compact safe menu", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v1: [identity, identity],
    resume_v1: [{ status: "ok", run: { id: "run-1" } }, { status: "none" }],
    request_run_render_v1: [{ status: "applied", runId: "run-1", stateVersion: 2 }],
  });
  const telegram = new RecordingTelegramPort();

  assertEquals(
    (await handleTelegramUpdate(
      dependencies(database, telegram),
      { ...commandBase, command: "resume" },
    )).route,
    "resume",
  );
  assertEquals(
    (await handleTelegramUpdate(
      dependencies(database, telegram),
      { ...commandBase, updateId: 103n, command: "unknown" },
    )).route,
    "menu",
  );
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v1",
    "resume_v1",
    "request_run_render_v1",
    "telegram_identity_v1",
    "resume_v1",
  ]);
  assertEquals(database.calls[2].args, {
    p_player_id: playerId,
    p_run_id: "run-1",
    p_request_key: "101",
  });
});

Deno.test("choice callbacks acknowledge first and distinguish cached, stale, rejected", async () => {
  for (const status of ["cached", "stale", "rejected"] as const) {
    const events: string[] = [];
    const responses: Record<string, readonly unknown[]> = {
      telegram_identity_v1: [identity],
      resolve_choice_v1: [{
        status,
        reason: status === "rejected" ? "invalid_token" : undefined,
        result: status === "cached" ? { projection: { run: { id: "run-1" } } } : undefined,
      }],
    };
    if (status !== "rejected") {
      responses.resume_v1 = [{ status: "ok", run: { id: "run-1" } }];
      responses.request_run_render_v1 = [{ status: "applied" }];
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
      status === "rejected" ? ["telegram_identity_v1", "resolve_choice_v1"] : [
        "telegram_identity_v1",
        "resolve_choice_v1",
        "resume_v1",
        "request_run_render_v1",
      ],
    );
  }
});

Deno.test("callback acknowledgement failure does not block the durable choice mutation", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v1: [identity],
    resolve_choice_v1: [{ status: "applied" }],
  });
  const result = await handleTelegramUpdate(
    dependencies(database, new FailingAnswerTelegram()),
    { ...callbackBase, data: "cb_0123456789abcdef0123456789abcdef" },
  );

  assertEquals(result.route, "choice_applied");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v1",
    "resolve_choice_v1",
  ]);
});

Deno.test("terminal stale callback repairs the latest owner-bound summary", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v1: [identity],
    resolve_choice_v1: [{ status: "stale" }],
    resume_v1: [{ status: "none" }],
    run_view_v1: [{ status: "ok", run: { id: "terminal-run" } }],
    request_run_render_v1: [{ status: "applied" }],
  });
  const result = await handleTelegramUpdate(
    dependencies(database),
    { ...callbackBase, updateId: 104n, data: "cb_0123456789abcdef0123456789abcdef" },
  );

  assertEquals(result.route, "choice_stale");
  assertEquals(database.calls.map((call) => call.rpc), [
    "telegram_identity_v1",
    "resolve_choice_v1",
    "resume_v1",
    "run_view_v1",
    "request_run_render_v1",
  ]);
  assertEquals(database.calls[3].args, { p_player_id: playerId, p_run_id: null });
  assertEquals(database.calls[4].args.p_run_id, "terminal-run");
});

Deno.test("expedition never substitutes a developed build for invalid persisted stats", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v1: [{ ...identity, stats: { ...identity.stats, maxHp: 0 } }],
  });
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram),
    { ...commandBase, command: "expedition" },
  );

  assertEquals(result.route, "expedition_rejected");
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_identity_v1"]);
  const send = telegram.calls[0];
  if (!send || send.operation !== "sendMessage") throw new Error("missing rejection");
  assertStringIncludes(send.input.text, "характеристики");
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
    telegram_deletion_identity_v1: [deletionIdentity],
    begin_identity_deletion_v2: [{ status: "applied" }],
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
  ]);
  const send = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!send || send.operation !== "sendMessage") throw new Error("missing retry card");
  assertStringIncludes(send.input.text, "не завершено");
  assertEquals(send.input.buttons?.flat()[0].callbackData, token);
});

Deno.test("/start exposes a blocked pending deletion instead of onboarding", async () => {
  const database = new ScriptedDatabase({
    telegram_identity_v1: [{ status: "rejected", reason: "identity_deletion_pending" }],
  });
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram),
    { ...commandBase, command: "start" },
  );

  assertEquals(result.route, "identity_pending");
  assertEquals(database.calls.map((call) => call.rpc), ["telegram_identity_v1"]);
  const send = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!send || send.operation !== "sendMessage") throw new Error("missing pending card");
  assertStringIncludes(send.input.text, "Видалення");
  assertStringIncludes(send.input.text, "/delete_me");
});
