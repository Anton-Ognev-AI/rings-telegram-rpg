import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  canonicalJson,
  sha256Hex,
} from "../../supabase/functions/_shared/domain/canonical-json.ts";
import type { RpcResult } from "./helpers/database.ts";

async function rpc(
  statement: PromiseLike<ReadonlyArray<unknown>>,
): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

async function startTutorial(
  sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  input: { readonly externalId: bigint; readonly at: string },
) {
  const identity = await rpc(sql`
    select public.telegram_identity_v2(${input.externalId.toString()}::bigint, true) as response
  `);
  await rpc(sql`
    select public.publish_fallback_day_v1(${input.at}::timestamptz) as response
  `);
  await rpc(sql`select public.advance_day_v2(${input.at}::timestamptz) as response`);
  const started = await rpc(sql`
    select public.start_run_v3(${String(identity.playerId)}::uuid, ${input.at}::timestamptz)
      as response
  `);
  const projection = started.projection as { run: { id: string; hp: number; maxHp: number } };
  return { playerId: String(identity.playerId), run: projection.run };
}

function terminalResolution(input: {
  readonly stage: number;
  readonly choiceId: string;
  readonly hpBefore: number;
  readonly hpAfter?: number;
  readonly nextStage?: number | null;
  readonly tutorial?: Readonly<Record<string, unknown>>;
}) {
  const hpAfter = input.hpAfter ?? 0;
  return {
    resolverVersion: "v1",
    stage: input.stage,
    exchange: null,
    choiceId: input.choiceId,
    outcome: "failure",
    clue: { id: "integration-clue", text: "Небезпечний слід" },
    rationale: "Інтеграційна перевірка смертельного вибору.",
    check: null,
    hp: {
      before: input.hpBefore,
      damage: input.hpBefore,
      vampHeal: 0,
      postHeal: 0,
      after: hpAfter,
    },
    bossHp: null,
    xp: { before: 0, delta: 0, after: 0 },
    terminal: hpAfter === 0 ? "defeated" : null,
    nextStage: input.nextStage ?? null,
    nextExchange: null,
    ...(input.tutorial ? { tutorial: input.tutorial } : {}),
  };
}

async function prepareV2(
  sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  input: {
    readonly playerId: string;
    readonly runId: string;
    readonly stateVersion: number;
    readonly stage: number;
    readonly choiceId: string;
    readonly resolution: Readonly<Record<string, unknown>>;
    readonly adapter?: Readonly<Record<string, unknown>> | null;
    readonly seed: string;
  },
) {
  const token = await sha256Hex(`tutorial-token:${input.seed}`);
  const context = await sha256Hex(`tutorial-context:${input.runId}:${input.stateVersion}`);
  const hash = await sha256Hex(canonicalJson(input.resolution));
  const response = await rpc(sql`
    select public.prepare_action_v2(
      ${input.playerId}::uuid,
      ${input.runId}::uuid,
      ${token},
      ${input.stateVersion}::bigint,
      ${input.stage}::smallint,
      0::smallint,
      ${input.choiceId},
      ${context},
      ${sql.json(JSON.parse(JSON.stringify(input.resolution)))}::jsonb,
      ${hash},
      clock_timestamp() + interval '1 hour',
      ${input.adapter ? sql.json(JSON.parse(JSON.stringify(input.adapter))) : null}::jsonb
    ) as response
  `);
  return { token, context, response };
}

async function resolveV2(
  sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  input: {
    readonly token: string;
    readonly updateId: bigint;
    readonly playerId: string;
    readonly context: string;
  },
) {
  return await rpc(sql`
    select public.resolve_choice_v2(
      ${input.token}, ${input.updateId.toString()}::bigint,
      ${input.playerId}::uuid, ${input.context}
    ) as response
  `);
}

Deno.test("identity v2 initializes canonical tutorial home exactly once", async () => {
  await withDatabase(async (sql) => {
    const externalId = 940000000000000001n;
    const created = await rpc(sql`
      select public.telegram_identity_v2(${externalId.toString()}::bigint, true) as response
    `);
    const replay = await rpc(sql`
      select public.telegram_identity_v2(${externalId.toString()}::bigint, true) as response
    `);
    assertEquals(created.status, "ok");
    assertEquals(replay.status, "ok");
    assertEquals(replay.playerId, created.playerId);

    const home = await rpc(sql`
      select public.player_home_v1(${String(created.playerId)}::uuid) as response
    `);
    assertEquals(home.status, "ok");
    assertEquals(home.tutorialCompleted, 0);
    assertEquals(home.profileVersion, 0);
    assertEquals(home.rank, "student");
    assertEquals(home.pendingOffer, null);

    const [counts] = await sql<{ onboarding: number; stats: number }[]>`
      select
        (select count(*)::integer from game.player_onboarding
          where player_id = ${String(created.playerId)}::uuid) as onboarding,
        (select count(*)::integer from game.player_stat_progression
          where player_id = ${String(created.playerId)}::uuid) as stats
    `;
    assertEquals(counts, { onboarding: 1, stats: 1 });
  });
});

Deno.test("start v3 derives the first tutorial snapshot and pins progression-v1", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000002::bigint, true) as response
    `);
    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-15T07:00:00Z'::timestamptz) as response
    `);
    await rpc(sql`
      select public.advance_day_v2('2026-08-15T07:00:00Z'::timestamptz) as response
    `);
    const started = await rpc(sql`
      select public.start_run_v3(
        ${String(identity.playerId)}::uuid,
        '2026-08-15T07:00:00Z'::timestamptz
      ) as response
    `);
    assertEquals(started.status, "applied");
    const projection = started.projection as {
      run: { id: string; maxHp: number };
      loadout: { partyMode: string; progressionConfig: string; companion: Record<string, number> };
    };
    assertEquals(projection.loadout.partyMode, "tutorial");
    assertEquals(projection.loadout.progressionConfig, "progression-v1");
    assertEquals(projection.loadout.companion, {
      maxHp: 5,
      physical: 4,
      magical: 4,
      agility: 4,
      defense: 2,
    });
    assertEquals(projection.run.maxHp, 45);

    const [assignment] = await sql<
      { tutorial_ordinal: number; guidance: string; rescue_used: boolean }[]
    >`select tutorial_ordinal, guidance, rescue_used
      from game.tutorial_run_assignments
      where run_id = ${projection.run.id}::uuid`;
    assertEquals(assignment, {
      tutorial_ordinal: 1,
      guidance: "full",
      rescue_used: false,
    });

    const view = await rpc(sql`
      select public.run_view_v2(${String(identity.playerId)}::uuid, ${projection.run.id}::uuid)
        as response
    `);
    assertEquals(view.tutorial, {
      ordinal: 1,
      guidance: "full",
      rescueUsed: false,
      resultCount: 0,
    });
  });
});

Deno.test("tutorial rescue is server-validated, one-shot and first completion is credited once", async () => {
  await withDatabase(async (sql) => {
    const fixture = await startTutorial(sql, {
      externalId: 940000000000000003n,
      at: "2026-08-16T07:00:00Z",
    });
    await sql`update game.runs set hp = 1 where id = ${fixture.run.id}::uuid`;

    const rescuedResolution = terminalResolution({
      stage: 1,
      choiceId: "s1-rescued",
      hpBefore: 1,
      hpAfter: 23,
      nextStage: 2,
      tutorial: { teacherRescue: true, teacherRestore: 23 },
    });
    const forged = await prepareV2(sql, {
      playerId: fixture.playerId,
      runId: fixture.run.id,
      stateVersion: 0,
      stage: 1,
      choiceId: "s1-forged",
      resolution: {
        ...rescuedResolution,
        choiceId: "s1-forged",
        hp: { ...(rescuedResolution.hp as Record<string, number>), after: 22 },
        tutorial: { teacherRescue: true, teacherRestore: 22 },
      },
      adapter: { teacherRescue: true, teacherRestore: 22 },
      seed: "forged",
    });
    assertEquals(forged.response, { status: "rejected", reason: "invalid_tutorial_adapter" });

    const prepared = await prepareV2(sql, {
      playerId: fixture.playerId,
      runId: fixture.run.id,
      stateVersion: 0,
      stage: 1,
      choiceId: "s1-rescued",
      resolution: rescuedResolution,
      adapter: { teacherRescue: true, teacherRestore: 23 },
      seed: "rescue",
    });
    assertEquals(prepared.response.status, "ok");
    const applied = await resolveV2(sql, {
      ...prepared,
      updateId: 950000000000000001n,
      playerId: fixture.playerId,
    });
    assertEquals(applied.status, "applied");

    const [afterRescue] = await sql<{
      hp: number;
      stage: number;
      rescue_used: boolean;
      teacher_restore: number;
    }[]>`select r.hp, r.stage, a.rescue_used,
      (s.resolution#>>'{tutorial,teacherRestore}')::integer as teacher_restore
      from game.runs r
      join game.tutorial_run_assignments a on a.run_id = r.id
      join game.run_stage_results s on s.run_id = r.id and s.stage = 1
      where r.id = ${fixture.run.id}::uuid`;
    assertEquals(afterRescue, { hp: 23, stage: 2, rescue_used: true, teacher_restore: 23 });

    const secondRescue = terminalResolution({
      stage: 2,
      choiceId: "s2-second-rescue",
      hpBefore: 23,
      hpAfter: 23,
      nextStage: 3,
      tutorial: { teacherRescue: true, teacherRestore: 23 },
    });
    const rejected = await prepareV2(sql, {
      playerId: fixture.playerId,
      runId: fixture.run.id,
      stateVersion: 1,
      stage: 2,
      choiceId: "s2-second-rescue",
      resolution: secondRescue,
      adapter: { teacherRescue: true, teacherRestore: 23 },
      seed: "second-rescue",
    });
    assertEquals(rejected.response, {
      status: "rejected",
      reason: "tutorial_rescue_unavailable",
    });

    const terminal = terminalResolution({
      stage: 2,
      choiceId: "s2-terminal",
      hpBefore: 23,
    });
    const terminalPrepared = await prepareV2(sql, {
      playerId: fixture.playerId,
      runId: fixture.run.id,
      stateVersion: 1,
      stage: 2,
      choiceId: "s2-terminal",
      resolution: terminal,
      seed: "terminal",
    });
    const terminalApplied = await resolveV2(sql, {
      ...terminalPrepared,
      updateId: 950000000000000002n,
      playerId: fixture.playerId,
    });
    const replay = await resolveV2(sql, {
      ...terminalPrepared,
      updateId: 950000000000000002n,
      playerId: fixture.playerId,
    });
    assertEquals(terminalApplied.status, "applied");
    assertEquals(replay.status, "cached");

    const [credited] = await sql<{
      tutorial_completed: number;
      rescue_used: boolean;
      credit_reason: string;
      grant_count: number;
      grant_delta: number;
      balance: number;
    }[]>`select o.tutorial_completed, a.rescue_used, a.credit_reason,
      (select count(*)::integer from game.xp_ledger
        where player_id = o.player_id and source_type = 'tutorial_completion') as grant_count,
      (select applied_delta::integer from game.xp_ledger
        where player_id = o.player_id and source_type = 'tutorial_completion') as grant_delta,
      x.balance::integer
      from game.player_onboarding o
      join game.tutorial_run_assignments a on a.player_id = o.player_id
      join game.xp_accounts x on x.player_id = o.player_id
      where o.player_id = ${fixture.playerId}::uuid`;
    assertEquals(credited, {
      tutorial_completed: 1,
      rescue_used: true,
      credit_reason: "hp_zero",
      grant_count: 1,
      grant_delta: 20,
      balance: 20,
    });
  });
});

Deno.test("second credited tutorial creates one ordered item and ring offer set", async () => {
  await withDatabase(async (sql) => {
    const first = await startTutorial(sql, {
      externalId: 940000000000000004n,
      at: "2026-08-17T07:00:00Z",
    });
    const firstTerminal = terminalResolution({
      stage: 1,
      choiceId: "first-terminal",
      hpBefore: first.run.hp,
    });
    const firstPrepared = await prepareV2(sql, {
      playerId: first.playerId,
      runId: first.run.id,
      stateVersion: 0,
      stage: 1,
      choiceId: "first-terminal",
      resolution: firstTerminal,
      seed: "first-credit",
    });
    await resolveV2(sql, {
      ...firstPrepared,
      updateId: 950000000000000003n,
      playerId: first.playerId,
    });

    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-18T07:00:00Z'::timestamptz) as response
    `);
    await rpc(sql`
      select public.advance_day_v2('2026-08-18T07:00:00Z'::timestamptz) as response
    `);
    const blocked = await rpc(sql`
      select public.start_run_v3(
        ${first.playerId}::uuid, '2026-08-18T07:00:00Z'::timestamptz
      ) as response
    `);
    assertEquals(blocked, {
      status: "rejected",
      reason: "initial_training_decision_pending",
    });
    const deferToken = "91".repeat(32);
    const deferContext = "92".repeat(32);
    assertEquals(
      (await rpc(sql`select public.prepare_player_action_v1(
      ${first.playerId}::uuid, ${deferToken}, 0, 7091,
      '{"kind":"defer_stat"}', ${deferContext},
      clock_timestamp() + interval '1 hour'
    ) as response`)).status,
      "ok",
    );
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${deferToken}, 950000000000000005, ${first.playerId}::uuid, 7091, ${deferContext}
    ) as response`)).status,
      "applied",
    );
    const secondStarted = await rpc(sql`
      select public.start_run_v3(
        ${first.playerId}::uuid, '2026-08-18T07:00:00Z'::timestamptz
      ) as response
    `);
    const second = (secondStarted.projection as { run: { id: string; hp: number } }).run;
    const secondTerminal = terminalResolution({
      stage: 1,
      choiceId: "second-terminal",
      hpBefore: second.hp,
    });
    const secondPrepared = await prepareV2(sql, {
      playerId: first.playerId,
      runId: second.id,
      stateVersion: 0,
      stage: 1,
      choiceId: "second-terminal",
      resolution: secondTerminal,
      seed: "second-credit",
    });
    const applied = await resolveV2(sql, {
      ...secondPrepared,
      updateId: 950000000000000004n,
      playerId: first.playerId,
    });
    assertEquals(applied.status, "applied");

    const offers = await sql<{ sequence: number; offer_kind: string; status: string }[]>`
      select sequence, offer_kind, status from game.player_offers
      where player_id = ${first.playerId}::uuid order by sequence
    `;
    assertEquals([...offers], [
      { sequence: 1, offer_kind: "tutorial_item", status: "pending" },
      { sequence: 2, offer_kind: "starter_ring", status: "pending" },
    ]);
    const [counts] = await sql<{ credited: number; grants: number; completed: number }[]>`
      select
        (select count(*)::integer from game.tutorial_run_assignments
          where player_id = ${first.playerId}::uuid and credited_at is not null) as credited,
        (select count(*)::integer from game.xp_ledger
          where player_id = ${first.playerId}::uuid
            and source_type = 'tutorial_completion') as grants,
        (select tutorial_completed::integer from game.player_onboarding
          where player_id = ${first.playerId}::uuid) as completed
    `;
    assertEquals(counts, { credited: 2, grants: 1, completed: 1 });
  });
});

Deno.test("expiry credits only three-result tutorials and abandon never credits", async () => {
  await withDatabase(async (sql) => {
    const at = "2026-08-19T07:00:00Z";
    const eligible = await startTutorial(sql, {
      externalId: 940000000000000005n,
      at,
    });
    const tooShort = await startTutorial(sql, {
      externalId: 940000000000000006n,
      at,
    });
    const abandoned = await startTutorial(sql, {
      externalId: 940000000000000007n,
      at,
    });

    for (const [fixture, count] of [[eligible, 3], [tooShort, 2]] as const) {
      for (let stage = 1; stage <= count; stage++) {
        const stored = {
          resolverVersion: "v1",
          stage,
          exchange: null,
          choiceId: `expiry-${stage}`,
          outcome: "neutral",
          hp: { before: 45, damage: 0, vampHeal: 0, postHeal: 0, after: 45 },
          bossHp: null,
          xp: { before: 0, delta: 0, after: 0 },
          terminal: null,
          nextStage: stage + 1,
          nextExchange: null,
        };
        await sql`insert into game.run_stage_results(
          run_id, stage, exchange, choice_id, resolution, resolution_sha256
        ) values (
          ${fixture.run.id}::uuid, ${stage}::smallint, 0, ${`expiry-${stage}`},
          ${sql.json(stored)}::jsonb, ${"e".repeat(64)}
        )`;
      }
      await sql`update game.runs set stage = ${count + 1}, state_version = ${count}
        where id = ${fixture.run.id}::uuid`;
    }
    await rpc(sql`
      select public.abandon_run_v1(${abandoned.playerId}::uuid, ${abandoned.run.id}::uuid)
        as response
    `);

    const advanced = await rpc(sql`
      select public.advance_day_v2('2026-08-20T08:00:00Z'::timestamptz) as response
    `);
    assertEquals(advanced.tutorialCredits, 1);
    const states = await sql<{
      player_id: string;
      completed: number;
      credits: number;
      grants: number;
      run_status: string;
    }[]>`select o.player_id, o.tutorial_completed::integer as completed,
      count(a.credited_at)::integer as credits,
      (select count(*)::integer from game.xp_ledger x
        where x.player_id = o.player_id and x.source_type = 'tutorial_completion') as grants,
      max(r.status::text) as run_status
      from game.player_onboarding o
      join game.tutorial_run_assignments a on a.player_id = o.player_id
      join game.runs r on r.id = a.run_id
      where o.player_id in (
        ${eligible.playerId}::uuid, ${tooShort.playerId}::uuid, ${abandoned.playerId}::uuid
      )
      group by o.player_id
      order by o.player_id`;
    const byPlayer = new Map(states.map((state) => [state.player_id, state]));
    assertEquals(byPlayer.get(eligible.playerId), {
      player_id: eligible.playerId,
      completed: 1,
      credits: 1,
      grants: 1,
      run_status: "expired",
    });
    assertEquals(byPlayer.get(tooShort.playerId), {
      player_id: tooShort.playerId,
      completed: 0,
      credits: 0,
      grants: 0,
      run_status: "expired",
    });
    assertEquals(byPlayer.get(abandoned.playerId), {
      player_id: abandoned.playerId,
      completed: 0,
      credits: 0,
      grants: 0,
      run_status: "abandoned",
    });

    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-20T08:00:00Z'::timestamptz) as response
    `);
    await rpc(sql`
      select public.advance_day_v2('2026-08-20T08:00:00Z'::timestamptz) as response
    `);
    for (const previous of [tooShort, abandoned]) {
      const retried = await rpc(sql`select public.start_run_v3(
        ${previous.playerId}::uuid, '2026-08-20T08:00:00Z'::timestamptz
      ) as response`);
      assertEquals(retried.status, "applied");
      const retriedRunId = String((retried.projection as { run: { id: string } }).run.id);
      assertEquals(retriedRunId === previous.run.id, false);
      const [attempts] = await sql<{ count: number; ordinal_sum: number }[]>`select
        count(*)::integer, sum(tutorial_ordinal)::integer as ordinal_sum
        from game.tutorial_run_assignments where player_id = ${previous.playerId}::uuid`;
      assertEquals(attempts, { count: 2, ordinal_sum: 2 });
    }
  });
});

Deno.test("starting a new day first credits an eligible expired tutorial", async () => {
  await withDatabase(async (sql) => {
    const previous = await startTutorial(sql, {
      externalId: 940000000000000008n,
      at: "2026-08-24T07:00:00Z",
    });
    for (let stage = 1; stage <= 3; stage++) {
      const stored = {
        resolverVersion: "v1",
        stage,
        exchange: null,
        choiceId: `implicit-expiry-${stage}`,
        outcome: "neutral",
        hp: { before: 45, damage: 0, vampHeal: 0, postHeal: 0, after: 45 },
        bossHp: null,
        xp: { before: 0, delta: 0, after: 0 },
        terminal: null,
        nextStage: stage + 1,
        nextExchange: null,
      };
      await sql`insert into game.run_stage_results(
        run_id, stage, exchange, choice_id, resolution, resolution_sha256
      ) values (
        ${previous.run.id}::uuid, ${stage}::smallint, 0, ${`implicit-expiry-${stage}`},
        ${sql.json(stored)}::jsonb, ${"f".repeat(64)}
      )`;
    }
    await sql`update game.runs set stage = 4, state_version = 3
      where id = ${previous.run.id}::uuid`;
    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-25T08:00:00Z'::timestamptz) as response
    `);

    const nextStart = await rpc(sql`select public.start_run_v3(
      ${previous.playerId}::uuid, '2026-08-25T08:00:00Z'::timestamptz
    ) as response`);
    assertEquals(nextStart, {
      status: "rejected",
      reason: "initial_training_decision_pending",
    });
    const [state] = await sql<{
      completed: number;
      credits: number;
      attempts: number;
      run_status: string;
    }[]>`select
      o.tutorial_completed::integer as completed,
      count(a.credited_at)::integer as credits,
      count(a.run_id)::integer as attempts,
      max(r.status::text) as run_status
      from game.player_onboarding o
      join game.tutorial_run_assignments a on a.player_id = o.player_id
      join game.runs r on r.id = a.run_id
      where o.player_id = ${previous.playerId}::uuid
      group by o.player_id`;
    assertEquals(state, { completed: 1, credits: 1, attempts: 1, run_status: "expired" });
  });
});
