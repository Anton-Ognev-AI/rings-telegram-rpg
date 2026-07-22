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
import {
  handleProgressionWithRestart,
  handleWithRestart,
  workWithRestart,
} from "./helpers/telegram-flow.ts";

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

Deno.test("resume keeps an already-current canonical card without a redundant edit", async () => {
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
    assertEquals(resumedByNewHandler.result.route, "run_resumed");
    const durable = await database.call<{
      status: string;
      run: { id: string; stage: number; stateVersion: number };
    }>("resume_v1", { p_player_id: identity.playerId });
    assertEquals(durable.run.stage, 2);
    assertEquals(durable.run.stateVersion, 1);
    const [renderState] = await sql<{ repairs: number; card_version: number }[]>`select
      (select count(*)::integer from game.outbox_messages
        where intent_type = 'repair_run_state' and status = 'pending') as repairs,
      (select last_state_version::integer from game.telegram_run_cards
        where run_id = ${durable.run.id}::uuid) as card_version`;
    assertEquals(renderState, { repairs: 0, card_version: durable.run.stateVersion });

    const afterRestart = await workWithRestart(
      sql,
      at,
      "52000000-0000-4000-8000-000000000003",
    );
    assertEquals(afterRestart.result, {
      leased: 0,
      sent: 0,
      retried: 0,
      dead: 0,
      deliveryUnknown: 0,
      superseded: 0,
    });
    assertEquals(afterRestart.telegram.calls, []);

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

Deno.test("repeated old expedition navigation is safe while the first card is queued", async () => {
  const pendingAt = "2026-09-17T07:00:00.000Z";
  const pendingTelegramId = 910000103;
  const pendingCommand = (text: string, updateId: number) =>
    normalizeTelegramUpdate({
      ...startFixture,
      update_id: updateId,
      message: {
        ...startFixture.message,
        message_id: updateId,
        from: { id: pendingTelegramId },
        chat: { id: pendingTelegramId },
        text,
      },
    });
  const pendingCallback = (data: string, updateId: number) =>
    normalizeTelegramUpdate({
      ...callbackFixture,
      update_id: updateId,
      callback_query: {
        ...callbackFixture.callback_query,
        id: `pending-callback-${updateId}`,
        from: { id: pendingTelegramId },
        message: {
          ...callbackFixture.callback_query.message,
          chat: { id: pendingTelegramId },
        },
        data,
      },
    });

  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    assertEquals((await publishFallbackDay(database, pendingAt)).status, "applied");
    assertEquals((await advanceDay(database, pendingAt)).status, "ok");
    await handleProgressionWithRestart(sql, pendingAt, pendingCommand("/start", 950201));

    const started = await handleProgressionWithRestart(
      sql,
      pendingAt,
      pendingCallback("nav:expedition", 950202),
    );
    assertEquals(started.result.route, "expedition_started");
    assertEquals(started.telegram.calls.length, 1);

    const recovered = await handleProgressionWithRestart(
      sql,
      pendingAt,
      pendingCallback("nav:expedition", 950203),
    );
    assertEquals(recovered.result.route, "run_delivery_pending");
    const pendingCard = recovered.telegram.calls.find((call) => call.operation === "sendMessage");
    if (!pendingCard || pendingCard.operation !== "sendMessage") {
      throw new Error("missing_pending_delivery_card");
    }
    assertEquals(
      pendingCard.input.buttons?.flat().map((button) => button?.callbackData),
      ["nav:resume", "nav:hero", "nav:menu"],
    );

    const [counts] = await sql<{
      active_runs: number;
      pending_outbox: number;
      cards: number;
    }[]>`select
      (select count(*)::integer from game.runs r
        where r.player_id = i.player_id and r.status = 'active') as active_runs,
      (select count(*)::integer
        from game.outbox_messages o
        join game.runs r on r.id::text = o.payload->>'runId'
        where r.player_id = i.player_id
          and o.status in ('pending', 'leased')) as pending_outbox,
      (select count(*)::integer
        from game.telegram_run_cards c
        join game.runs r on r.id = c.run_id
        where r.player_id = i.player_id) as cards
    from game.identity_links i
    where i.platform = 'telegram'
      and i.external_id = ${String(pendingTelegramId)}::bigint`;
    assertEquals(counts, { active_runs: 1, pending_outbox: 1, cards: 0 });

    const cleanupDelivery = await workWithRestart(
      sql,
      pendingAt,
      "52000000-0000-4000-8000-000000000005",
    );
    assertEquals(cleanupDelivery.result.sent, 1);
    const [cleanup] = await sql<{ pending_outbox: number }[]>`select count(*)::integer
      as pending_outbox from game.outbox_messages where status in ('pending', 'leased')`;
    assertEquals(cleanup.pending_outbox, 0);
  });
});
