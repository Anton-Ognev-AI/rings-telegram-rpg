import {
  assertEquals,
  assertNotMatch,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type {
  CommandResult,
  DatabasePort,
} from "../../supabase/functions/_shared/application/database-port.ts";
import type { TelegramRunView } from "../../supabase/functions/_shared/application/prepare-run-card.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import { RecordingTelegramPort } from "../../supabase/functions/_shared/telegram/fake.ts";
import {
  handleCanonicalProfileCallback,
  handleHeroManagementCallback,
  openHeroManagement,
  type ProgressionRouterDependencies,
  renderCanonicalProgressionCard,
  routeCanonicalHome,
} from "../../supabase/functions/_shared/telegram/progression-router.ts";
import type { NormalizedCallbackUpdate } from "../../supabase/functions/_shared/telegram/update.ts";

const playerId = "10000000-0000-4000-8000-000000000001";
const callbackKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const fallback = fallbackJson as DungeonContentV1;

class ScriptedDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  constructor(private readonly responses: Readonly<Record<string, readonly unknown[]>>) {}

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    const queue = this.responses[rpc];
    const index = this.calls.filter((call) => call.rpc === rpc).length - 1;
    if (!queue || index >= queue.length) throw new Error(`unexpected_rpc:${rpc}`);
    return Promise.resolve(queue[index] as T);
  }
}

function dependencies(
  database: DatabasePort,
  telegram = new RecordingTelegramPort(),
): ProgressionRouterDependencies {
  return {
    database,
    telegram,
    clock: new FixedClock("2026-08-25T07:00:00.000Z"),
    callbackKey,
  };
}

const build = {
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
      label: "База",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    magical: [{
      source: "base",
      label: "База",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    agility: [{
      source: "base",
      label: "База",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    vitality: [{
      source: "base",
      label: "База",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    defense: [{
      source: "base",
      label: "База",
      operation: "add",
      amount: 5,
      result: 5,
      bps: null,
    }],
    maxHp: [{
      source: "base",
      label: "База",
      operation: "add",
      amount: 40,
      result: 40,
      bps: null,
    }],
    postHeal: [],
  },
};

function home(overrides: Readonly<Record<string, unknown>> = {}): CommandResult {
  return {
    status: "ok",
    playerId,
    profileVersion: 0,
    tutorialCompleted: 0,
    rank: "student",
    initialTrainingResolved: false,
    freeXp: 20,
    pendingOffer: null,
    activeRunId: null,
    lastTerminalRunId: null,
    personalBestStage: null,
    training: {
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
    },
    build,
    ...overrides,
  };
}

Deno.test("canonical home prioritizes pending decisions and one server-derived start", async () => {
  const pendingDatabase = new ScriptedDatabase({
    player_home_v1: [home({
      pendingOffer: {
        id: "30000000-0000-4000-8000-000000000001",
        kind: "tutorial_item",
        sequence: 1,
        sourceRunId: "20000000-0000-4000-8000-000000000001",
        payload: { itemKey: "training_armor", slot: "armor", bonuses: { defense: 2 } },
      },
      activeRunId: "active-must-not-win",
      lastTerminalRunId: "20000000-0000-4000-8000-000000000001",
    })],
    request_run_render_v2: [{ status: "applied" }],
  });
  const pendingTelegram = new RecordingTelegramPort();
  const pending = await routeCanonicalHome(
    dependencies(pendingDatabase, pendingTelegram),
    { playerId, chatId: 700000001n, updateId: 1001n, destination: "home" },
  );
  assertEquals(pending.route, "offer_pending");
  assertEquals(pendingDatabase.calls.map((call) => call.rpc), [
    "player_home_v1",
    "request_run_render_v2",
  ]);
  assertEquals(pendingTelegram.calls.length, 0);

  const startDatabase = new ScriptedDatabase({
    start_run_v3: [{ status: "applied", projection: { run: { id: "run-1" } } }],
  });
  const started = await routeCanonicalHome(dependencies(startDatabase), {
    playerId,
    chatId: 700000001n,
    updateId: 1002n,
    destination: "expedition",
  });
  assertEquals(started.route, "expedition_started");
  assertEquals(startDatabase.calls, [{
    rpc: "start_run_v3",
    args: { p_player_id: playerId, p_at: "2026-08-25T07:00:00.000Z" },
  }]);
});

Deno.test("blocked expedition restores the pending canonical decision instead of going silent", async () => {
  const database = new ScriptedDatabase({
    start_run_v3: [{ status: "rejected", reason: "tutorial_decision_pending" }],
    player_home_v1: [home({
      pendingOffer: {
        id: "30000000-0000-4000-8000-000000000001",
        kind: "tutorial_item",
        sequence: 1,
        sourceRunId: "20000000-0000-4000-8000-000000000001",
        payload: { itemKey: "training_armor", slot: "armor", bonuses: { defense: 2 } },
      },
      lastTerminalRunId: "20000000-0000-4000-8000-000000000001",
    })],
    request_run_render_v2: [{ status: "applied" }],
  });
  const result = await routeCanonicalHome(dependencies(database), {
    playerId,
    chatId: 700000001n,
    updateId: 1005n,
    destination: "expedition",
  });
  assertEquals(result.route, "offer_pending");
  assertEquals(database.calls.map((call) => call.rpc), [
    "start_run_v3",
    "player_home_v1",
    "request_run_render_v2",
  ]);
});

Deno.test("cached expedition restores a safe pending-delivery card instead of going silent", async () => {
  const database = new ScriptedDatabase({
    start_run_v3: [{ status: "cached", projection: { run: { id: "run-1" } } }],
    player_home_v1: [home({
      initialTrainingResolved: true,
      activeRunId: "run-1",
    })],
    request_run_render_v2: [{ status: "rejected", reason: "card_unavailable" }],
  });
  const telegram = new RecordingTelegramPort();

  const result = await routeCanonicalHome(dependencies(database, telegram), {
    playerId,
    chatId: 700000001n,
    updateId: 1006n,
    destination: "expedition",
  });

  assertEquals(result.route, "run_delivery_pending");
  assertEquals(database.calls.map((call) => call.rpc), [
    "start_run_v3",
    "player_home_v1",
    "request_run_render_v2",
  ]);
  const sent = telegram.calls[0];
  if (!sent || sent.operation !== "sendMessage") throw new Error("missing_pending_card");
  assertEquals(
    sent.input.buttons?.flat().map((button) => button?.callbackData),
    ["nav:resume", "nav:hero", "nav:menu"],
  );
});

Deno.test("resume recovers only card_unavailable and keeps other render rejections fail-closed", async () => {
  const recoverableDatabase = new ScriptedDatabase({
    player_home_v1: [home({ initialTrainingResolved: true, activeRunId: "run-1" })],
    request_run_render_v2: [{ status: "rejected", reason: "card_unavailable" }],
  });
  const telegram = new RecordingTelegramPort();
  const recovered = await routeCanonicalHome(dependencies(recoverableDatabase, telegram), {
    playerId,
    chatId: 700000001n,
    updateId: 1007n,
    destination: "resume",
  });
  assertEquals(recovered.route, "run_delivery_pending");
  assertEquals(telegram.calls.length, 1);

  const rejectedDatabase = new ScriptedDatabase({
    player_home_v1: [home({ initialTrainingResolved: true, activeRunId: "run-1" })],
    request_run_render_v2: [{ status: "rejected", reason: "actor_mismatch" }],
  });
  await assertRejects(
    () =>
      routeCanonicalHome(dependencies(rejectedDatabase), {
        playerId,
        chatId: 700000001n,
        updateId: 1008n,
        destination: "resume",
      }),
    Error,
    "request_run_render_rejected",
  );
});

Deno.test("hero and Academy are direct read-only projections with no prepared mutation", async () => {
  for (const destination of ["hero", "academy"] as const) {
    const database = new ScriptedDatabase({
      player_home_v1: [home({ tutorialCompleted: 2, rank: "novice", personalBestStage: 4 })],
    });
    const telegram = new RecordingTelegramPort();
    const result = await routeCanonicalHome(dependencies(database, telegram), {
      playerId,
      chatId: 700000001n,
      updateId: 1003n,
      destination,
    });
    assertEquals(result.route, destination);
    assertEquals(database.calls.map((call) => call.rpc), ["player_home_v1"]);
    assertEquals(
      database.calls.some((call) => call.rpc === "prepare_player_action_v1"),
      false,
    );
    const sent = telegram.calls[0];
    if (!sent || sent.operation !== "sendMessage") throw new Error("missing_read_only_card");
    assertStringIncludes(sent.input.text, destination === "hero" ? "Герой" : "Академія");
  }
});

Deno.test("hero management prepares only affordable canonical forecasts for its message", async () => {
  const mixedTraining = {
    masteryCostXp: 20,
    options: [
      {
        stat: "physical",
        current: 6,
        next: 7,
        cost: 28,
        statDelta: 1,
        maxHpDelta: 0,
        defenseDelta: 0,
      },
      {
        stat: "magical",
        current: 7,
        next: 8,
        cost: 50,
        statDelta: 1,
        maxHpDelta: 0,
        defenseDelta: 0,
      },
      {
        stat: "agility",
        current: 6,
        next: 7,
        cost: 28,
        statDelta: 1,
        maxHpDelta: 0,
        defenseDelta: 0,
      },
      {
        stat: "vitality",
        current: 7,
        next: 8,
        cost: 50,
        statDelta: 1,
        maxHpDelta: 4,
        defenseDelta: 0,
      },
    ],
  };
  const database = new ScriptedDatabase({
    player_home_v1: [home({
      freeXp: 43,
      activeRunId: "active-run",
      training: mixedTraining,
    })],
    prepare_player_action_v1: [{ status: "ok" }, { status: "ok" }],
  });
  const telegram = new RecordingTelegramPort();

  const result = await openHeroManagement(dependencies(database, telegram), {
    playerId,
    chatId: 700000001n,
    messageId: 9001n,
  });

  assertEquals(result.route, "hero_management");
  assertEquals(database.calls.map((call) => call.rpc), [
    "player_home_v1",
    "prepare_player_action_v1",
    "prepare_player_action_v1",
  ]);
  assertEquals(
    database.calls.slice(1).map((call) => call.args.p_action),
    [
      { kind: "buy_stat", stat: "physical" },
      { kind: "buy_stat", stat: "agility" },
    ],
  );
  assertEquals(
    database.calls.slice(1).every((call) => call.args.p_expected_message_id === "9001"),
    true,
  );
  const edited = telegram.calls[0];
  if (!edited || edited.operation !== "editMessage") throw new Error("missing_management_edit");
  assertEquals(edited.input.messageId, 9001n);
  assertStringIncludes(edited.input.text, "Поточна експедиція не зміниться");
  assertStringIncludes(edited.input.text, "Максимум HP: 40 → 44");
  assertNotMatch(edited.input.text, /\b(?:physical|magical|agility|vitality) \+\d/u);
  assertEquals(
    edited.input.buttons?.flat().filter((button) => button.callbackData.startsWith("hm_")).length,
    2,
  );
});

Deno.test("hero management prepares affordable ring mastery from the canonical build", async () => {
  const ringBuild = {
    ...build,
    loadoutSnapshot: {
      ...build.loadoutSnapshot,
      rings: [{
        kind: "weapon",
        color: "blue",
        rarity: "ordinary",
        label: "Кільце зброї",
        masteryPercent: 2,
        investedXp: 40,
        blueBudget: 2000,
        combatBps: 1500,
      }],
    },
  };
  const database = new ScriptedDatabase({
    player_home_v1: [home({ freeXp: 43, build: ringBuild })],
    prepare_player_action_v1: Array.from({ length: 5 }, () => ({ status: "ok" })),
  });
  const telegram = new RecordingTelegramPort();

  await openHeroManagement(dependencies(database, telegram), {
    playerId,
    chatId: 700000001n,
    messageId: 9001n,
  });

  assertEquals(database.calls.at(-1)?.args.p_action, { kind: "train_ring_mastery" });
  const edited = telegram.calls[0];
  if (!edited || edited.operation !== "editMessage") throw new Error("missing_mastery_edit");
  assertStringIncludes(edited.input.text, "Майстерність кільця: 2% → 3% · 20 XP");
  assertEquals(
    edited.input.buttons?.flat().some((button) => button.callbackData.startsWith("hm_")),
    true,
  );
});

Deno.test("hero management callbacks refresh canonical state without touching run cards", async () => {
  for (const status of ["applied", "cached", "stale"] as const) {
    const database = new ScriptedDatabase({
      resolve_player_action_v2: [{ status }],
      player_home_v1: [home({ profileVersion: 1, freeXp: 0, activeRunId: "active-run" })],
    });
    const telegram = new RecordingTelegramPort();
    const result = await handleHeroManagementCallback(dependencies(database, telegram), {
      playerId,
      update: {
        kind: "callback",
        updateId: 1010n,
        telegramExternalId: 700000001n,
        chatId: 700000001n,
        messageId: 9001n,
        callbackQueryId: "hero-callback",
        data: "hm_0123456789abcdef0123456789abcdef",
      },
    });

    assertEquals(result.route, `hero_management_${status}`);
    assertEquals(database.calls.map((call) => call.rpc), [
      "resolve_player_action_v2",
      "player_home_v1",
    ]);
    assertEquals(database.calls[0].args.p_telegram_update_id, "1010");
    assertEquals(database.calls[0].args.p_callback_message_id, "9001");
    assertEquals(
      database.calls.some((call) =>
        call.rpc === "request_run_render_v2" || call.rpc === "request_profile_run_render_v1"
      ),
      false,
    );
    assertEquals(telegram.calls[0]?.operation, "editMessage");
  }
});

Deno.test("invalid or rejected hero management callbacks use one generic recovery", async () => {
  for (
    const [data, responses] of [
      ["hm_", {}],
      [
        "hm_0123456789abcdef0123456789abcdef",
        { resolve_player_action_v2: [{ status: "rejected", reason: "invalid_token" }] },
      ],
    ] as const
  ) {
    const database = new ScriptedDatabase(responses);
    const telegram = new RecordingTelegramPort();
    const result = await handleHeroManagementCallback(dependencies(database, telegram), {
      playerId,
      update: {
        kind: "callback",
        updateId: 1011n,
        telegramExternalId: 700000001n,
        chatId: 700000001n,
        messageId: 9001n,
        callbackQueryId: "hero-rejected",
        data,
      },
    });

    assertEquals(result.route, "hero_management_rejected");
    const sent = telegram.calls[0];
    if (!sent || sent.operation !== "sendMessage") throw new Error("missing_hero_recovery");
    assertStringIncludes(sent.input.text, "актуальну картку героя");
    assertEquals(sent.input.buttons?.[0]?.[0]?.callbackData, "nav:hero");
  }
});

Deno.test("hero management edit failure is recoverable through a cached Telegram retry", async () => {
  const update: NormalizedCallbackUpdate = {
    kind: "callback",
    updateId: 1012n,
    telegramExternalId: 700000001n,
    chatId: 700000001n,
    messageId: 9001n,
    callbackQueryId: "hero-edit-retry",
    data: "hm_0123456789abcdef0123456789abcdef",
  };
  const failedDatabase = new ScriptedDatabase({
    resolve_player_action_v2: [{ status: "applied" }],
    player_home_v1: [home({ profileVersion: 1, freeXp: 0 })],
  });
  await assertRejects(() =>
    handleHeroManagementCallback(
      dependencies(
        failedDatabase,
        new RecordingTelegramPort([{ kind: "retryable" }]),
      ),
      { playerId, update },
    )
  );

  const retryDatabase = new ScriptedDatabase({
    resolve_player_action_v2: [{ status: "cached" }],
    player_home_v1: [home({ profileVersion: 1, freeXp: 0 })],
  });
  const retryTelegram = new RecordingTelegramPort();
  const retry = await handleHeroManagementCallback(
    dependencies(retryDatabase, retryTelegram),
    { playerId, update },
  );
  assertEquals(retry.route, "hero_management_cached");
  assertEquals(retryTelegram.calls[0]?.operation, "editMessage");
});

Deno.test("profile callback binds actor, Telegram update and canonical message before rerender", async () => {
  const database = new ScriptedDatabase({
    resolve_player_action_v2: [{ status: "applied" }],
    player_home_v1: [home({ profileVersion: 1, lastTerminalRunId: "terminal-run" })],
    request_profile_run_render_v1: [{ status: "applied" }],
  });
  const update: NormalizedCallbackUpdate = {
    kind: "callback",
    updateId: 1004n,
    telegramExternalId: 700000001n,
    chatId: 700000001n,
    messageId: 9001n,
    callbackQueryId: "callback-1",
    data: "pa_0123456789abcdef0123456789abcdef",
  };
  const result = await handleCanonicalProfileCallback(dependencies(database), {
    playerId,
    update,
  });
  assertEquals(result.route, "profile_applied");
  assertEquals(database.calls.map((call) => call.rpc), [
    "resolve_player_action_v2",
    "player_home_v1",
    "request_profile_run_render_v1",
  ]);
  assertEquals(database.calls[0].args.p_telegram_update_id, "1004");
  assertEquals(database.calls[0].args.p_callback_message_id, "9001");
  assertEquals(database.calls[2].args, {
    p_player_id: playerId,
    p_run_id: "terminal-run",
    p_profile_version: 1,
  });
});

Deno.test("rejected profile callbacks give one generic visible recovery path", async () => {
  for (
    const [data, responses] of [
      ["pa_bad", { resolve_player_action_v2: [{ status: "rejected", reason: "invalid_token" }] }],
      [
        "pa_0123456789abcdef0123456789abcdef",
        { resolve_player_action_v2: [{ status: "rejected", reason: "stale_profile" }] },
      ],
    ] as const
  ) {
    const database = new ScriptedDatabase(responses);
    const telegram = new RecordingTelegramPort();
    const result = await handleCanonicalProfileCallback(dependencies(database, telegram), {
      playerId,
      update: {
        kind: "callback",
        updateId: 1006n,
        telegramExternalId: 700000001n,
        chatId: 700000001n,
        messageId: 9001n,
        callbackQueryId: "callback-rejected",
        data,
      },
    });
    assertEquals(result.route, "profile_rejected");
    const sent = telegram.calls[0];
    if (!sent || sent.operation !== "sendMessage") throw new Error("missing_recovery_card");
    assertStringIncludes(sent.input.text, "актуальну картку");
    assertEquals(sent.input.buttons?.[0]?.[0]?.callbackData, "nav:home");
  }
});

function terminalView(): TelegramRunView {
  return {
    status: "ok",
    run: {
      id: "20000000-0000-4000-8000-000000000001",
      playerId,
      cycleId: "2026-08-25",
      status: "defeated",
      phase: "terminal",
      stateVersion: 4,
      stage: 4,
      exchange: null,
      hp: 0,
      maxHp: 45,
      bossHp: null,
      xpEarned: 20,
    },
    selfSnapshot: build.selfSnapshot,
    loadout: { partyMode: "tutorial", companion: {}, items: [], rings: [] },
    content: { schemaVersion: "dungeon-v1", stages: [] } as never,
    cycle: {
      cycleId: "2026-08-25",
      opensAt: "2026-08-25T06:00:00.000Z",
      closesAt: "2026-08-26T06:00:00.000Z",
      graceEndsAt: "2026-08-26T08:00:00.000Z",
      status: "open",
    },
    lastResolution: null,
    card: { messageId: "9001", lastStateVersion: 4 },
    tutorial: { ordinal: 1, guidance: "full", rescueUsed: false, resultCount: 4 },
  };
}

function blockedFieldView(): TelegramRunView {
  const stage = fallback.stages[2];
  const choice = stage.choices?.[0];
  if (!choice) throw new Error("missing_field_test_choice");
  return {
    ...terminalView(),
    run: {
      ...terminalView().run,
      status: "active",
      phase: "blocked_by_offer",
      stateVersion: 3,
      stage: 4,
      hp: 45,
      xpEarned: 25,
    },
    content: fallback,
    lastResolution: {
      resolverVersion: "v1",
      stage: 3,
      exchange: null,
      choiceId: choice.id,
      outcome: "success",
      clue: stage.clues[0],
      rationale: "Влучний підхід відкрив приховану схованку.",
      check: {
        stat: "magical",
        selfPower: 5,
        companionPower: 4,
        totalPower: 9,
        threshold: 4,
      },
      hp: { before: 45, damage: 0, vampHeal: 0, postHeal: 0, after: 45 },
      bossHp: null,
      xp: { before: 10, delta: 15, after: 25 },
      terminal: null,
      nextStage: 4,
      nextExchange: null,
    } as never,
    card: { messageId: "9001", lastStateVersion: 3 },
    tutorial: { ordinal: 1, guidance: "full", rescueUsed: false, resultCount: 3 },
  };
}

Deno.test("active field discovery prepares only accept or discard for the bound run card", async () => {
  const view = blockedFieldView();
  const offerId = "30000000-0000-4000-8000-000000000003";
  const database = new ScriptedDatabase({
    prepare_player_action_v1: [{ status: "ok" }, { status: "ok" }],
  });
  const card = await renderCanonicalProgressionCard(
    {
      database,
      clock: new FixedClock("2026-08-25T07:00:00.000Z"),
      callbackKey,
    },
    {
      home: home({
        activeRunId: view.run.id,
        pendingOffer: {
          id: offerId,
          kind: "field_item",
          sequence: 1,
          sourceRunId: view.run.id,
          payload: { itemKey: "training_armor", slot: "armor", bonuses: { defense: 2 } },
        },
      }),
      view,
    },
  );

  if (!card) throw new Error("missing_field_offer_card");
  assertStringIncludes(card.text, "Результат етапу 3");
  assertStringIncludes(card.text, "Знахідка між етапами");
  assertStringIncludes(card.text, "Навчальний обладунок");
  assertStringIncludes(card.text, "наступному етапі 4");
  assertEquals(database.calls.map((call) => call.rpc), [
    "prepare_player_action_v1",
    "prepare_player_action_v1",
  ]);
  assertEquals(database.calls.map((call) => call.args.p_action), [
    { kind: "accept_item", offerId },
    { kind: "discard_item", offerId },
  ]);
  assertEquals(card.buttons.flat().every((button) => button.callbackData.startsWith("pa_")), true);
});

Deno.test("canonical terminal card prepares every training action for its existing message", async () => {
  const database = new ScriptedDatabase({
    prepare_player_action_v1: Array.from({ length: 5 }, () => ({ status: "ok" })),
  });
  const card = await renderCanonicalProgressionCard(
    {
      database,
      clock: new FixedClock("2026-08-25T07:00:00.000Z"),
      callbackKey,
    },
    {
      home: home({ tutorialCompleted: 1, lastTerminalRunId: terminalView().run.id }),
      view: terminalView(),
    },
  );
  if (!card) throw new Error("missing_training_card");
  assertStringIncludes(card.text, "Перше тренування");
  assertStringIncludes(card.text, "Максимум HP: 40 → 44");
  assertNotMatch(card.text, /\b(?:physical|magical|agility|vitality) \+\d/u);
  assertEquals(database.calls.length, 5);
  assertEquals(database.calls.every((call) => call.rpc === "prepare_player_action_v1"), true);
  assertEquals(database.calls.every((call) => call.args.p_expected_message_id === "9001"), true);
  assertEquals(card.buttons.flat().every((button) => button.callbackData.startsWith("pa_")), true);
});

Deno.test("item then ring cards prepare only legal ordered actions", async () => {
  const itemDatabase = new ScriptedDatabase({
    prepare_player_action_v1: [{ status: "ok" }, { status: "ok" }],
  });
  const itemCard = await renderCanonicalProgressionCard(
    {
      database: itemDatabase,
      clock: new FixedClock("2026-08-25T07:00:00.000Z"),
      callbackKey,
    },
    {
      home: home({
        tutorialCompleted: 1,
        initialTrainingResolved: true,
        lastTerminalRunId: terminalView().run.id,
        pendingOffer: {
          id: "30000000-0000-4000-8000-000000000001",
          kind: "tutorial_item",
          sequence: 1,
          sourceRunId: terminalView().run.id,
          payload: { itemKey: "training_armor", slot: "armor", bonuses: { defense: 2 } },
        },
      }),
      view: { ...terminalView(), tutorial: { ...terminalView().tutorial!, ordinal: 2 } },
    },
  );
  if (!itemCard) throw new Error("missing_item_card");
  assertStringIncludes(itemCard.text, "Навчальний обладунок");
  assertEquals(itemDatabase.calls.length, 2);

  const ringDatabase = new ScriptedDatabase({
    prepare_player_action_v1: Array.from({ length: 4 }, () => ({ status: "ok" })),
  });
  const ringCard = await renderCanonicalProgressionCard(
    {
      database: ringDatabase,
      clock: new FixedClock("2026-08-25T07:00:00.000Z"),
      callbackKey,
    },
    {
      home: home({
        tutorialCompleted: 1,
        initialTrainingResolved: true,
        lastTerminalRunId: terminalView().run.id,
        pendingOffer: {
          id: "30000000-0000-4000-8000-000000000002",
          kind: "starter_ring",
          sequence: 2,
          sourceRunId: terminalView().run.id,
          payload: {
            choices: [
              {
                kind: "weapon",
                label: "Кільце зброї",
                technique: "Точний удар",
                effectText: "Фізична сила 7 → 8",
                mainItemLabel: "Навчальний меч",
              },
              {
                kind: "fire",
                label: "Кільце вогню",
                technique: "Вогняний імпульс",
                effectText: "Магічна сила 7 → 8",
                mainItemLabel: "Учнівський жезл",
              },
              {
                kind: "defense",
                label: "Кільце захисту",
                technique: "Стійка варта",
                effectText: "Захист 5 → 5",
                mainItemLabel: "Навчальний меч",
              },
              {
                kind: "healing",
                label: "Кільце лікування",
                technique: "Відновлення",
                effectText: "Після бою HP +1",
                mainItemLabel: "Навчальний меч",
              },
            ],
          },
        },
      }),
      view: { ...terminalView(), tutorial: { ...terminalView().tutorial!, ordinal: 2 } },
    },
  );
  if (!ringCard) throw new Error("missing_ring_card");
  assertStringIncludes(ringCard.text, "Кільце лікування");
  assertEquals(ringDatabase.calls.length, 4);
});
