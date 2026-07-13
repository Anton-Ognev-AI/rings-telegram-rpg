import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import { normalizeTelegramUpdate } from "../../supabase/functions/_shared/telegram/update.ts";
import callbackFixture from "../fixtures/telegram/callback.json" with { type: "json" };
import startFixture from "../fixtures/telegram/start.json" with { type: "json" };
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";
import { handleWithRestart, workWithRestart } from "./helpers/telegram-flow.ts";

const at = "2026-09-16T07:00:00.000Z";
const telegramId = 910000102;

function command(text: string, updateId: number) {
  return normalizeTelegramUpdate({
    ...startFixture,
    update_id: updateId,
    message: {
      ...startFixture.message,
      message_id: updateId,
      from: { id: telegramId },
      chat: { id: telegramId },
      text,
    },
  });
}

function callback(data: string, updateId: number) {
  return normalizeTelegramUpdate({
    ...callbackFixture,
    update_id: updateId,
    callback_query: {
      ...callbackFixture.callback_query,
      id: `restart-callback-${updateId}`,
      from: { id: telegramId },
      message: {
        ...callbackFixture.callback_query.message,
        chat: { id: telegramId },
      },
      data,
    },
  });
}

Deno.test("resume enqueues a fresh canonical edit when no render is already pending", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    assertEquals((await publishFallbackDay(database, at)).status, "applied");
    assertEquals((await advanceDay(database, at)).status, "ok");
    await handleWithRestart(sql, at, command("/start", 950101));
    const identity = await database.call<{ playerId: string }>("telegram_identity_v1", {
      p_external_id: String(telegramId),
      p_create_if_missing: false,
    });
    await handleWithRestart(sql, at, callback("nav:expedition", 950102));

    const initial = await workWithRestart(
      sql,
      at,
      "52000000-0000-4000-8000-000000000001",
    );
    const initialDelivery = initial.telegram.calls.find((call) => call.operation === "sendMessage");
    if (!initialDelivery || initialDelivery.operation !== "sendMessage") {
      throw new Error("missing_initial_card");
    }
    const firstChoice = initialDelivery.input.buttons?.flat()[0];
    if (!firstChoice) throw new Error("missing_first_choice");
    assertEquals(
      (await handleWithRestart(sql, at, callback(firstChoice.callbackData, 950103))).result.route,
      "choice_applied",
    );

    const choiceDelivery = await workWithRestart(
      sql,
      at,
      "52000000-0000-4000-8000-000000000002",
    );
    assertEquals(choiceDelivery.result.sent, 1);
    const choiceEdit = choiceDelivery.telegram.calls.find(
      (call) => call.operation === "editMessage",
    );
    if (!choiceEdit || choiceEdit.operation !== "editMessage") {
      throw new Error("missing_choice_edit");
    }
    assertStringIncludes(choiceEdit.input.text, "Результат етапу 1: Успіх");
    assertStringIncludes(choiceEdit.input.text, "етап 2/10");
    const [beforeResume] = await sql<
      { actionable: number }[]
    >`select count(*)::integer as actionable
      from game.outbox_messages
      where status in ('pending', 'leased')`;
    assertEquals(beforeResume.actionable, 0);

    const resumedByNewHandler = await handleWithRestart(sql, at, command("/resume", 950104));
    assertEquals(resumedByNewHandler.result.route, "resume");
    const durable = await database.call<{
      status: string;
      run: { id: string; stage: number; stateVersion: number };
    }>("resume_v1", { p_player_id: identity.playerId });
    assertEquals(durable.run.stage, 2);
    assertEquals(durable.run.stateVersion, 1);
    const [repair] = await sql<{ repairs: number }[]>`select count(*)::integer as repairs
      from game.outbox_messages
      where intent_type = 'repair_run_state' and status = 'pending'`;
    assertEquals(repair.repairs, 1);

    const afterRestart = await workWithRestart(
      sql,
      at,
      "52000000-0000-4000-8000-000000000003",
    );
    assertEquals(afterRestart.result.sent, 1);
    const edited = afterRestart.telegram.calls.find((call) => call.operation === "editMessage");
    if (!edited || edited.operation !== "editMessage") throw new Error("missing_resumed_edit");
    assertStringIncludes(edited.input.text, "Результат етапу 1: Успіх");
    assertStringIncludes(edited.input.text, "етап 2/10");

    const emptyAfterSecondRestart = await workWithRestart(
      sql,
      at,
      "52000000-0000-4000-8000-000000000004",
    );
    assertEquals(emptyAfterSecondRestart.result.leased, 0);
    const [counts] = await sql<{ results: number; state_version: number; cards: number }[]>`select
      (select count(*)::integer from game.run_stage_results where run_id = r.id) as results,
      r.state_version::integer,
      (select count(*)::integer from game.telegram_run_cards where run_id = r.id) as cards
    from game.runs r where r.id = ${durable.run.id}::uuid`;
    assertEquals(counts, { results: 1, state_version: 1, cards: 1 });
  });
});
