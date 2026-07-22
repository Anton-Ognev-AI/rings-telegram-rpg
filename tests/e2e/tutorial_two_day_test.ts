import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import type { Sql } from "npm:postgres@3.4.7";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import type { TelegramRunView } from "../../supabase/functions/_shared/application/prepare-run-card.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import {
  type RecordedTelegramCall,
  RecordingTelegramPort,
} from "../../supabase/functions/_shared/telegram/fake.ts";
import { normalizeTelegramUpdate } from "../../supabase/functions/_shared/telegram/update.ts";
import golden from "../fixtures/replays/v1/golden-full-run.json" with { type: "json" };
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";
import { handleProgressionWithRestart, workWithRestart } from "./helpers/telegram-flow.ts";

const fallback = fallbackJson as DungeonContentV1;

interface TutorialScenario {
  readonly telegramId: bigint;
  readonly firstAt: string;
  readonly secondAt: string;
  readonly firstMessageId: bigint;
  readonly secondMessageId: bigint;
  updateSequence: number;
  workerSequence: number;
}

function command(scenario: TutorialScenario, command: "start" | "expedition", at: string) {
  scenario.updateSequence += 1;
  return {
    at,
    update: normalizeTelegramUpdate({
      update_id: scenario.updateSequence,
      message: {
        message_id: scenario.updateSequence,
        from: { id: Number(scenario.telegramId) },
        chat: { id: Number(scenario.telegramId) },
        text: `/${command}`,
      },
    }),
  };
}

function callback(scenario: TutorialScenario, data: string, at: string, messageId: bigint) {
  scenario.updateSequence += 1;
  return {
    at,
    update: normalizeTelegramUpdate({
      update_id: scenario.updateSequence,
      callback_query: {
        id: `tutorial-callback-${scenario.updateSequence}`,
        from: { id: Number(scenario.telegramId) },
        message: {
          message_id: Number(messageId),
          chat: { id: Number(scenario.telegramId) },
        },
        data,
      },
    }),
  };
}

function handle(
  sql: Sql,
  input: ReturnType<typeof command> | ReturnType<typeof callback>,
) {
  return handleProgressionWithRestart(sql, input.at, input.update);
}

function delivery(calls: readonly RecordedTelegramCall[]): RecordedTelegramCall & {
  readonly operation: "sendMessage" | "editMessage";
} {
  const call = calls.findLast((candidate) =>
    candidate.operation === "sendMessage" || candidate.operation === "editMessage"
  );
  if (!call) throw new Error("missing_delivery");
  return call;
}

function choicesFor(view: TelegramRunView): readonly { readonly id: string }[] {
  const stage = fallback.stages[view.run.stage - 1];
  if (!stage) throw new Error(`missing_stage:${view.run.stage}`);
  return view.run.stage === 10
    ? stage.bossExchanges?.[(view.run.exchange ?? 1) - 1]?.choices ?? []
    : stage.choices ?? [];
}

function preferredChoiceId(view: TelegramRunView): string {
  const selected = golden.choices.find((choice) =>
    choice.stage === view.run.stage && choice.exchange === view.run.exchange
  );
  if (!selected) throw new Error(`missing_golden_choice:${view.run.stage}:${view.run.exchange}`);
  return selected.choiceId;
}

async function nextWorker(
  scenario: TutorialScenario,
  sql: Sql,
  at: string,
  messageId: bigint,
) {
  const workerId = `54000000-0000-4000-8000-${String(scenario.workerSequence).padStart(12, "0")}`;
  scenario.workerSequence += 1;
  return await workWithRestart(
    sql,
    at,
    workerId,
    new RecordingTelegramPort([{ kind: "success", messageId }]),
  );
}

async function playUntilProfileDecision(
  scenario: TutorialScenario,
  sql: Sql,
  database: PostgresRpcDatabase,
  playerId: string,
  runId: string,
  at: string,
  messageId: bigint,
) {
  let worked = await nextWorker(scenario, sql, at, messageId);
  assertEquals(worked.result.sent, 1);
  let card = delivery(worked.telegram.calls);

  for (let step = 0; step < 12; step += 1) {
    const buttons = card.input.buttons?.flat() ?? [];
    if (!buttons.some((button) => button.callbackData.startsWith("cb_"))) {
      if (!card.input.text.includes("Знахідка між етапами")) return card;
      assertStringIncludes(card.input.text, "інвентарю немає");
      const accept = buttons.find((button) => button.callbackData.startsWith("pa_"));
      if (!accept) throw new Error("missing_field_accept_button");
      const handled = await handle(
        sql,
        callback(scenario, accept.callbackData, at, messageId),
      );
      assertEquals(handled.result.route, "profile_applied");
      worked = await nextWorker(scenario, sql, at, messageId);
      assertEquals(worked.result.sent, 1);
      card = delivery(worked.telegram.calls);
      continue;
    }
    const view = await database.call<TelegramRunView>("run_view_v3", {
      p_player_id: playerId,
      p_run_id: runId,
    });
    assertEquals(view.status, "ok");
    const index = choicesFor(view).findIndex((choice) => choice.id === preferredChoiceId(view));
    const selected = buttons[index];
    if (!selected || !selected.callbackData.startsWith("cb_")) {
      throw new Error(`missing_preferred_button:${view.run.stage}`);
    }
    const handled = await handle(
      sql,
      callback(scenario, selected.callbackData, at, messageId),
    );
    assertEquals(handled.result.route, "choice_applied");
    worked = await nextWorker(scenario, sql, at, messageId);
    assertEquals(worked.result.sent, 1);
    card = delivery(worked.telegram.calls);
  }
  throw new Error("tutorial_run_did_not_reach_profile_decision");
}

function firstButton(card: ReturnType<typeof delivery>, prefix: "pa_" | "nav:") {
  const button = buttonsWithPrefix(card, prefix)[0];
  if (!button) throw new Error(`missing_button:${prefix}`);
  return button;
}

function buttonsWithPrefix(card: ReturnType<typeof delivery>, prefix: "pa_" | "nav:") {
  return (card.input.buttons?.flat() ?? []).filter((candidate) =>
    candidate.callbackData.startsWith(prefix)
  ).map((button) => button.callbackData);
}

async function runTwoDayScenario(
  sql: Sql,
  scenario: TutorialScenario,
  itemDecision: "accept" | "discard",
) {
  const database = new PostgresRpcDatabase(sql);
  assertEquals((await publishFallbackDay(database, scenario.firstAt)).status, "applied");
  assertEquals((await advanceDay(database, scenario.firstAt)).status, "ok");

  const startedHome = await handle(sql, command(scenario, "start", scenario.firstAt));
  assertEquals(startedHome.result.route, "home");
  const homeDelivery = delivery(startedHome.telegram.calls);
  assertStringIncludes(homeDelivery.input.text, "0/2");

  const identity = await database.call<{ status: string; playerId: string }>(
    "telegram_identity_v2",
    { p_external_id: scenario.telegramId.toString(), p_create_if_missing: false },
  );
  assertEquals(identity.status, "ok");
  assertEquals(
    (await handle(sql, command(scenario, "expedition", scenario.firstAt))).result.route,
    "expedition_started",
  );
  const firstRun = await database.call<{ status: string; run: { id: string } }>("resume_v1", {
    p_player_id: identity.playerId,
  });
  const trainingCard = await playUntilProfileDecision(
    scenario,
    sql,
    database,
    identity.playerId,
    firstRun.run.id,
    scenario.firstAt,
    scenario.firstMessageId,
  );
  assertStringIncludes(trainingCard.input.text, "Перше тренування");
  const trainingButtons = buttonsWithPrefix(trainingCard, "pa_");
  const trainingAction = callback(
    scenario,
    firstButton(trainingCard, "pa_"),
    scenario.firstAt,
    scenario.firstMessageId,
  );
  assertEquals(
    (await handle(sql, trainingAction)).result.route,
    "profile_applied",
  );
  assertEquals((await handle(sql, trainingAction)).result.route, "profile_cached");
  assertEquals(
    (await handle(
      sql,
      callback(scenario, trainingButtons[1]!, scenario.firstAt, scenario.firstMessageId),
    )).result.route,
    "profile_stale",
  );
  const progressedWorked = await nextWorker(
    scenario,
    sql,
    scenario.firstAt,
    scenario.firstMessageId,
  );
  assertEquals(progressedWorked.result.sent, 1);
  assertStringIncludes(delivery(progressedWorked.telegram.calls).input.text, "1/2");

  assertEquals((await publishFallbackDay(database, scenario.secondAt)).status, "applied");
  assertEquals((await advanceDay(database, scenario.secondAt)).status, "ok");
  assertEquals(
    (await handle(sql, command(scenario, "expedition", scenario.secondAt))).result.route,
    "expedition_started",
  );
  const secondRun = await database.call<{ status: string; run: { id: string } }>("resume_v1", {
    p_player_id: identity.playerId,
  });
  const itemCard = await playUntilProfileDecision(
    scenario,
    sql,
    database,
    identity.playerId,
    secondRun.run.id,
    scenario.secondAt,
    scenario.secondMessageId,
  );
  assertStringIncludes(itemCard.input.text, "предмет");
  const itemButtons = buttonsWithPrefix(itemCard, "pa_");
  const itemButtonIndex = itemDecision === "accept" ? 0 : 1;
  const competingButtonIndex = itemDecision === "accept" ? 1 : 0;
  assertEquals(
    (await handle(
      sql,
      callback(
        scenario,
        itemButtons[itemButtonIndex]!,
        scenario.secondAt,
        scenario.secondMessageId,
      ),
    )).result.route,
    "profile_applied",
  );
  assertEquals(
    (await handle(
      sql,
      callback(
        scenario,
        itemButtons[competingButtonIndex]!,
        scenario.secondAt,
        scenario.secondMessageId,
      ),
    )).result.route,
    "profile_stale",
  );
  const ringWorked = await nextWorker(
    scenario,
    sql,
    scenario.secondAt,
    scenario.secondMessageId,
  );
  assertEquals(ringWorked.result.sent, 1);
  const ringCard = delivery(ringWorked.telegram.calls);
  assertStringIncludes(ringCard.input.text, "синє кільце");
  const ringButtons = buttonsWithPrefix(ringCard, "pa_");
  assertEquals(
    (await handle(
      sql,
      callback(scenario, ringButtons[0]!, scenario.secondAt, scenario.secondMessageId),
    )).result.route,
    "profile_applied",
  );
  assertEquals(
    (await handle(
      sql,
      callback(scenario, ringButtons[1]!, scenario.secondAt, scenario.secondMessageId),
    )).result.route,
    "profile_stale",
  );
  const completedWorked = await nextWorker(
    scenario,
    sql,
    scenario.secondAt,
    scenario.secondMessageId,
  );
  assertEquals(completedWorked.result.sent, 1);
  assertStringIncludes(delivery(completedWorked.telegram.calls).input.text, "Герой");

  const academy = await handle(
    sql,
    callback(scenario, "nav:academy", scenario.secondAt, scenario.secondMessageId),
  );
  assertEquals(academy.result.route, "academy");
  assertStringIncludes(delivery(academy.telegram.calls).input.text, "2/2");
  assertStringIncludes(delivery(academy.telegram.calls).input.text, "Новак");

  const [durable] = await sql<{
    tutorial_completed: number;
    academy_rank: string;
    profile_version: number;
    first_purchased_stat: string;
    physical: number;
    credited_runs: number;
    offers: number;
    accepted_offers: number;
    discarded_offers: number;
    tutorial_grants: number;
    tutorial_grant_xp: number;
    equipment: number;
    main_item: string | null;
    ring_kind: string | null;
    rings: number;
    profile_actions: number;
    cards: number;
    pending_outbox: number;
  }[]>`select
      o.tutorial_completed::integer,
      o.academy_rank,
      o.profile_version::integer,
      o.first_purchased_stat,
      s.physical::integer,
      (select count(*)::integer from game.tutorial_run_assignments
        where player_id = o.player_id and credited_at is not null) as credited_runs,
      (select count(*)::integer from game.player_offers
        where player_id = o.player_id) as offers,
      (select count(*)::integer from game.player_offers
        where player_id = o.player_id and status = 'accepted') as accepted_offers,
      (select count(*)::integer from game.player_offers
        where player_id = o.player_id and status = 'discarded') as discarded_offers,
      (select count(*)::integer from game.xp_ledger x
        where x.player_id = o.player_id
          and x.source_type = 'tutorial_completion') as tutorial_grants,
      (select coalesce(sum(x.delta), 0)::integer from game.xp_ledger x
        where x.player_id = o.player_id
          and x.source_type = 'tutorial_completion') as tutorial_grant_xp,
      (select count(*)::integer from game.player_equipment e
        where e.player_id = o.player_id) as equipment,
      (select e.item_key from game.player_equipment e
        where e.player_id = o.player_id and e.slot = 'main') as main_item,
      (select pr.ring_kind from game.player_rings pr
        where pr.player_id = o.player_id) as ring_kind,
      (select count(*)::integer from game.player_rings
        where player_id = o.player_id) as rings,
      (select count(*)::integer from game.processed_player_actions
        where player_id = o.player_id and status = 'applied') as profile_actions,
      (select count(*)::integer from game.telegram_run_cards c
        join game.runs r on r.id = c.run_id where r.player_id = o.player_id) as cards,
      (select count(*)::integer from game.outbox_messages m
        join game.runs r on r.id = (m.payload->>'runId')::uuid
        where r.player_id = o.player_id and m.status in ('pending', 'leased')) as pending_outbox
    from game.player_onboarding o
    join game.player_stats s on s.player_id = o.player_id
    where o.player_id = ${identity.playerId}::uuid`;
  assertEquals(durable, {
    tutorial_completed: 2,
    academy_rank: "novice",
    profile_version: 4,
    first_purchased_stat: "physical",
    physical: 6,
    credited_runs: 2,
    offers: 3,
    accepted_offers: itemDecision === "accept" ? 3 : 2,
    discarded_offers: itemDecision === "discard" ? 1 : 0,
    tutorial_grants: 1,
    tutorial_grant_xp: 20,
    equipment: itemDecision === "accept" ? 3 : 2,
    main_item: "training_sword",
    ring_kind: "weapon",
    rings: 1,
    profile_actions: 4,
    cards: 2,
    pending_outbox: 0,
  });

  const snapshots = await sql<{ physical: number }[]>`select
        (s.snapshot->>'physical')::integer as physical
      from game.runs r
      join game.run_self_snapshots s on s.run_id = r.id
      where r.player_id = ${identity.playerId}::uuid
      order by r.started_at`;
  assertEquals([...snapshots], [{ physical: 5 }, { physical: 6 }]);

  const terminalRuns = await sql<{
    status: string;
    hp: number;
    credit_reason: string;
    result_count_at_credit: number;
    actual_result_count: number;
  }[]>`select
      r.status::text,
      r.hp::integer,
      a.credit_reason,
      a.result_count_at_credit::integer,
      (select count(*)::integer from game.run_stage_results s
        where s.run_id = r.id) as actual_result_count
    from game.runs r
    join game.tutorial_run_assignments a on a.run_id = r.id
    where r.player_id = ${identity.playerId}::uuid
    order by r.started_at`;
  assertEquals(terminalRuns.length, 2);
  for (const run of terminalRuns) {
    assertEquals(run.status, "defeated");
    assertEquals(run.hp, 0);
    assertEquals(run.credit_reason, "hp_zero");
    assertEquals(run.result_count_at_credit, run.actual_result_count);
    if (run.actual_result_count < 2) {
      throw new Error("tutorial_run_ended_before_meaningful_play");
    }
  }
}

Deno.test("two played Academy days accept an item and progress 0/2 to 2/2", async () => {
  await withDatabase((sql) =>
    runTwoDayScenario(
      sql,
      {
        telegramId: 920000401n,
        firstAt: "2026-10-01T07:00:00.000Z",
        secondAt: "2026-10-02T07:00:00.000Z",
        firstMessageId: 810000000n,
        secondMessageId: 810000001n,
        updateSequence: 960000,
        workerSequence: 1,
      },
      "accept",
    )
  );
});

Deno.test("discarding the tutorial item still reaches the starter-ring decision", async () => {
  await withDatabase((sql) =>
    runTwoDayScenario(
      sql,
      {
        telegramId: 920000402n,
        firstAt: "2026-10-03T07:00:00.000Z",
        secondAt: "2026-10-04T07:00:00.000Z",
        firstMessageId: 810000002n,
        secondMessageId: 810000003n,
        updateSequence: 961000,
        workerSequence: 101,
      },
      "discard",
    )
  );
});
