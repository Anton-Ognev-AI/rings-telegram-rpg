import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import type { Sql } from "npm:postgres@3.4.7";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import { RecordingTelegramPort } from "../../supabase/functions/_shared/telegram/fake.ts";
import { normalizeTelegramUpdate } from "../../supabase/functions/_shared/telegram/update.ts";
import callbackFixture from "../fixtures/telegram/callback.json" with { type: "json" };
import golden from "../fixtures/replays/v1/golden-full-run.json" with { type: "json" };
import startFixture from "../fixtures/telegram/start.json" with { type: "json" };
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";
import { handleWithRestart, workWithRestart } from "./helpers/telegram-flow.ts";

const at = "2026-09-15T07:00:00.000Z";
const telegramId = 910000101;
const fallback = fallbackJson as DungeonContentV1;

function startUpdate() {
  return normalizeTelegramUpdate({
    ...startFixture,
    update_id: 940101,
    message: {
      ...startFixture.message,
      from: { id: telegramId },
      chat: { id: telegramId },
    },
  });
}

function callbackUpdate(data: string, updateId: number) {
  return normalizeTelegramUpdate({
    ...callbackFixture,
    update_id: updateId,
    callback_query: {
      ...callbackFixture.callback_query,
      id: `synthetic-callback-${updateId}`,
      from: { id: telegramId },
      message: {
        ...callbackFixture.callback_query.message,
        chat: { id: telegramId },
      },
      data,
    },
  });
}

function delivery(port: RecordingTelegramPort) {
  const call = port.calls.find((candidate) =>
    candidate.operation === "sendMessage" || candidate.operation === "editMessage"
  );
  if (!call) throw new Error("missing_delivery");
  return call;
}

function choiceIndex(stage: number, exchange: 1 | 2 | null, choiceId: string): number {
  const definition = fallback.stages[stage - 1];
  const choices = stage === 10
    ? definition.bossExchanges?.[(exchange ?? 1) - 1]?.choices ?? []
    : definition.choices ?? [];
  const index = choices.findIndex((choice) => choice.id === choiceId);
  if (index < 0) throw new Error(`missing_choice:${choiceId}`);
  return index;
}

async function durableCounts(sql: Sql, runId: string) {
  const [row] = await sql<{
    state_version: number;
    results: number;
    ledger: number;
    outbox: number;
    processed: number;
    cards: number;
  }[]>`select
    r.state_version::integer,
    (select count(*)::integer from game.run_stage_results where run_id = r.id) as results,
    (select count(*)::integer from game.xp_ledger where source_id = r.id) as ledger,
    (select count(*)::integer from game.outbox_messages
      where logical_key like ('run:' || r.id || ':%')) as outbox,
    (select count(*)::integer from game.processed_actions pa
      join game.action_tokens at on at.token_sha256 = pa.token_sha256
      where at.run_id = r.id) as processed,
    (select count(*)::integer from game.telegram_run_cards where run_id = r.id) as cards
  from game.runs r where r.id = ${runId}::uuid`;
  return row;
}

Deno.test("persisted fake Telegram completes the fallback dungeon through both boss exchanges", async () => {
  await withDatabase(async (sql) => {
    const fixtureText = JSON.stringify({ startFixture, callbackFixture });
    assertEquals(fixtureText.includes("username"), false);
    assertEquals(fixtureText.includes("first_name"), false);

    const database = new PostgresRpcDatabase(sql);
    assertEquals((await publishFallbackDay(database, at)).status, "applied");
    assertEquals((await advanceDay(database, at)).status, "ok");

    assertEquals((await handleWithRestart(sql, at, startUpdate())).result.route, "home");
    const identity = await database.call<{ status: string; playerId: string }>(
      "telegram_identity_v1",
      { p_external_id: String(telegramId), p_create_if_missing: false },
    );
    assertEquals(identity.status, "ok");
    assertEquals(
      (await handleWithRestart(sql, at, callbackUpdate("nav:expedition", 940102))).result.route,
      "expedition_started",
    );
    const resumed = await database.call<{ status: string; run: { id: string } }>("resume_v1", {
      p_player_id: identity.playerId,
    });
    const runId = resumed.run.id;

    const transcript: Array<ReturnType<typeof delivery>> = [];
    let lastAppliedUpdate: ReturnType<typeof callbackUpdate> | null = null;
    let terminalCompetingCallback: string | null = null;
    let workerSequence = 1;
    let worked = await workWithRestart(
      sql,
      at,
      `51000000-0000-4000-8000-${String(workerSequence).padStart(12, "0")}`,
    );
    transcript.push(delivery(worked.telegram));
    assertEquals(worked.result.sent, 1);

    for (const [step, selected] of golden.choices.entries()) {
      const current = transcript.at(-1)!.input;
      const buttons = (current.buttons?.flat() ?? []).filter((button) =>
        button.callbackData.startsWith("cb_")
      );
      const selectedIndex = choiceIndex(
        selected.stage,
        selected.exchange as 1 | 2 | null,
        selected.choiceId,
      );
      const selectedButton = buttons[selectedIndex];
      if (!selectedButton) throw new Error(`missing_button:${selected.choiceId}`);
      terminalCompetingCallback = buttons[(selectedIndex + 1) % buttons.length]?.callbackData ??
        null;
      const updateId = 941000 + step;
      const appliedUpdate = callbackUpdate(selectedButton.callbackData, updateId);
      lastAppliedUpdate = appliedUpdate;
      const applied = await handleWithRestart(sql, at, appliedUpdate);
      assertEquals(applied.result.route, "choice_applied");

      if (step === 2) {
        const replay = await handleWithRestart(sql, at, appliedUpdate);
        assertEquals(replay.result.route, "choice_cached");
        const competing = buttons[(selectedIndex + 1) % buttons.length];
        const stale = await handleWithRestart(
          sql,
          at,
          callbackUpdate(competing.callbackData, updateId + 500),
        );
        assertEquals(stale.result.route, "choice_stale");
      }

      workerSequence += 1;
      worked = await workWithRestart(
        sql,
        at,
        `51000000-0000-4000-8000-${String(workerSequence).padStart(12, "0")}`,
      );
      assertEquals(worked.result.sent, 1);
      transcript.push(delivery(worked.telegram));
    }

    assertEquals(transcript.length, 12);
    assertEquals(transcript[0].operation, "sendMessage");
    assertEquals(transcript.filter((card) => card.operation === "editMessage").length, 11);
    const allText = transcript.map((card) => card.input.text).join("\n");
    assertStringIncludes(allText, "Мінібос");
    assertStringIncludes(allText, "Фінальне випробування · фаза 1");
    assertStringIncludes(allText, "Фінальне випробування · фаза 2");
    assertStringIncludes(allText, "Шкода босу:");
    assertStringIncludes(transcript.at(-1)!.input.text, "Підсумок: Перемога над загрозою");
    assertStringIncludes(transcript.at(-1)!.input.text, "Шкода босу:");
    assertStringIncludes(transcript.at(-1)!.input.text, "XP: 150");

    if (terminalCompetingCallback === null) throw new Error("missing_terminal_competing_choice");
    const staleTerminal = await handleWithRestart(
      sql,
      at,
      callbackUpdate(terminalCompetingCallback, 949999),
    );
    assertEquals(staleTerminal.result.route, "choice_stale");
    workerSequence += 1;
    const repairedStaleTerminal = await workWithRestart(
      sql,
      at,
      `51000000-0000-4000-8000-${String(workerSequence).padStart(12, "0")}`,
    );
    assertEquals(repairedStaleTerminal.result, {
      leased: 0,
      sent: 0,
      retried: 0,
      dead: 0,
      deliveryUnknown: 0,
      superseded: 0,
    });
    assertEquals(repairedStaleTerminal.telegram.calls, []);

    if (lastAppliedUpdate === null) throw new Error("missing_terminal_callback");
    const cachedTerminal = await handleWithRestart(sql, at, lastAppliedUpdate);
    assertEquals(cachedTerminal.result.route, "choice_cached");
    const [terminalRepair] = await sql<{ repairs: number }[]>`select count(*)::integer as repairs
      from game.outbox_messages
      where intent_type = 'repair_run_state' and status = 'pending'`;
    assertEquals(terminalRepair.repairs, 0);
    const [terminalCard] = await sql<{ card_version: number; run_version: number }[]>`select
      c.last_state_version::integer as card_version,
      r.state_version::integer as run_version
      from game.telegram_run_cards c
      join game.runs r on r.id = c.run_id
      where c.run_id = ${runId}::uuid`;
    assertEquals(terminalCard.card_version, terminalCard.run_version);
    workerSequence += 1;
    const repairedTerminal = await workWithRestart(
      sql,
      at,
      `51000000-0000-4000-8000-${String(workerSequence).padStart(12, "0")}`,
    );
    assertEquals(repairedTerminal.result, {
      leased: 0,
      sent: 0,
      retried: 0,
      dead: 0,
      deliveryUnknown: 0,
      superseded: 0,
    });
    assertEquals(repairedTerminal.telegram.calls, []);

    assertEquals(await durableCounts(sql, runId), {
      state_version: 11,
      results: 11,
      ledger: 10,
      outbox: 12,
      processed: 11,
      cards: 1,
    });
  });
});
