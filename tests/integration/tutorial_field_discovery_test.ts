import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  canonicalJson,
  sha256Hex,
} from "../../supabase/functions/_shared/domain/canonical-json.ts";
import type { RpcResult } from "./helpers/database.ts";

type Sql = Parameters<Parameters<typeof withDatabase>[0]>[0];

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

async function startTutorial(sql: Sql, externalId: bigint, at: string) {
  const identity = await rpc(sql`
    select public.telegram_identity_v2(${externalId.toString()}::bigint, true) as response
  `);
  await rpc(sql`select public.publish_fallback_day_v1(${at}::timestamptz) as response`);
  await rpc(sql`select public.advance_day_v2(${at}::timestamptz) as response`);
  const started = await rpc(sql`
    select public.start_run_v3(${String(identity.playerId)}::uuid, ${at}::timestamptz) as response
  `);
  const projection = started.projection as {
    run: { id: string; hp: number; maxHp: number; stateVersion: number; stage: number };
    selfSnapshot: Record<string, number>;
  };
  return {
    playerId: String(identity.playerId),
    run: projection.run,
    initialSelf: projection.selfSnapshot,
  };
}

function nonterminalResolution(input: {
  readonly stage: number;
  readonly hp: number;
  readonly xp: number;
  readonly outcome?: "success" | "neutral" | "failure";
}) {
  const outcome = input.outcome ?? "neutral";
  const damage = outcome === "success" ? 0 : 1;
  return {
    resolverVersion: "v1",
    stage: input.stage,
    exchange: null,
    choiceId: `field-stage-${input.stage}`,
    outcome,
    clue: { id: `field-clue-${input.stage}`, text: "Навчальна зачіпка" },
    rationale: "Синтетичний результат перевіряє атомарну знахідку.",
    check: null,
    hp: {
      before: input.hp,
      damage,
      vampHeal: 0,
      postHeal: 0,
      after: input.hp - damage,
    },
    bossHp: null,
    xp: { before: input.xp, delta: 0, after: input.xp },
    terminal: null,
    nextStage: input.stage + 1,
    nextExchange: null,
  };
}

async function applyStage(
  sql: Sql,
  input: {
    readonly playerId: string;
    readonly runId: string;
    readonly stage: number;
    readonly stateVersion: number;
    readonly hp: number;
    readonly xp?: number;
    readonly resolver: "v2" | "v3";
    readonly updateId: bigint;
  },
) {
  const resolution = nonterminalResolution({
    stage: input.stage,
    hp: input.hp,
    xp: input.xp ?? 0,
  });
  const token = await sha256Hex(`field-stage-token:${input.runId}:${input.stage}`);
  const context = await sha256Hex(`field-stage-context:${input.runId}:${input.stage}`);
  const hash = await sha256Hex(canonicalJson(resolution));
  const prepared = input.resolver === "v3"
    ? await rpc(sql`
      select public.prepare_action_v3(
        ${input.playerId}::uuid, ${input.runId}::uuid, ${token},
        ${input.stateVersion}::bigint, ${input.stage}::smallint, 0::smallint,
        ${resolution.choiceId}, ${context},
        ${sql.json(JSON.parse(JSON.stringify(resolution)))}::jsonb, ${hash},
        clock_timestamp() + interval '1 hour', null::jsonb
      ) as response
    `)
    : await rpc(sql`
      select public.prepare_action_v2(
        ${input.playerId}::uuid, ${input.runId}::uuid, ${token},
        ${input.stateVersion}::bigint, ${input.stage}::smallint, 0::smallint,
        ${resolution.choiceId}, ${context},
        ${sql.json(JSON.parse(JSON.stringify(resolution)))}::jsonb, ${hash},
        clock_timestamp() + interval '1 hour', null::jsonb
      ) as response
    `);
  assertEquals(
    prepared.status,
    "ok",
    `prepare stage ${input.stage} at state ${input.stateVersion}: ${JSON.stringify(prepared)}`,
  );
  const resolved = input.resolver === "v3"
    ? await rpc(sql`
      select public.resolve_choice_v3(
        ${token}, ${input.updateId.toString()}::bigint, ${input.playerId}::uuid, ${context}
      ) as response
    `)
    : await rpc(sql`
      select public.resolve_choice_v2(
        ${token}, ${input.updateId.toString()}::bigint, ${input.playerId}::uuid, ${context}
      ) as response
    `);
  assertEquals(resolved.status, "applied");
  return resolution.hp.after;
}

async function prepareFieldAction(
  sql: Sql,
  input: {
    readonly playerId: string;
    readonly offerId: string;
    readonly action: "accept_item" | "discard_item";
    readonly messageId: bigint;
    readonly seed: string;
  },
) {
  const token = await sha256Hex(`field-profile-token:${input.seed}`);
  const context = await sha256Hex(`field-profile-context:${input.seed}`);
  const prepared = await rpc(sql`
    select public.prepare_player_action_v1(
      ${input.playerId}::uuid, ${token}, 0::bigint, ${input.messageId.toString()}::bigint,
      ${sql.json({ kind: input.action, offerId: input.offerId })}::jsonb,
      ${context}, clock_timestamp() + interval '1 hour'
    ) as response
  `);
  assertEquals(prepared.status, "ok");
  return { token, context };
}

async function reachGuaranteedDiscovery(
  sql: Sql,
  externalId: bigint,
  at: string,
  updateBase: bigint,
) {
  const fixture = await startTutorial(sql, externalId, at);
  let hp = fixture.run.hp;
  hp = await applyStage(sql, {
    playerId: fixture.playerId,
    runId: fixture.run.id,
    stage: 1,
    stateVersion: 0,
    hp,
    resolver: "v2",
    updateId: updateBase,
  });
  hp = await applyStage(sql, {
    playerId: fixture.playerId,
    runId: fixture.run.id,
    stage: 2,
    stateVersion: 1,
    hp,
    resolver: "v2",
    updateId: updateBase + 1n,
  });
  await applyStage(sql, {
    playerId: fixture.playerId,
    runId: fixture.run.id,
    stage: 3,
    stateVersion: 2,
    hp,
    resolver: "v3",
    updateId: updateBase + 2n,
  });
  return fixture;
}

Deno.test("stage-three pity blocks once, accept versions the build, and replay is cached", async () => {
  await withDatabase(async (sql) => {
    const fixture = await reachGuaranteedDiscovery(
      sql,
      940000000000000101n,
      "2026-09-01T07:00:00Z",
      950000000000000100n,
    );
    const [blocked] = await sql<{
      phase: string;
      state_version: number;
      stage: number;
      offer_id: string;
      slot: "armor" | "talisman";
      item_key: string;
    }[]>`select r.phase, r.state_version::integer, r.stage::integer,
      o.id as offer_id, o.payload->>'slot' as slot, o.payload->>'itemKey' as item_key
      from game.runs r
      join game.player_offers o on o.source_run_id = r.id and o.status = 'pending'
      where r.id = ${fixture.run.id}::uuid`;
    assertEquals(blocked.phase, "blocked_by_offer");
    assertEquals(blocked.state_version, 3);
    assertEquals(blocked.stage, 4);
    assertEquals(
      blocked.item_key,
      blocked.slot === "armor" ? "training_armor" : "student_talisman",
    );

    const blockedResolution = nonterminalResolution({ stage: 4, hp: 43, xp: 0 });
    const blockedPrepare = await rpc(sql`
      select public.prepare_action_v3(
        ${fixture.playerId}::uuid, ${fixture.run.id}::uuid, ${"ab".repeat(32)}, 3::bigint,
        4::smallint, 0::smallint, 'blocked-choice', ${"bc".repeat(32)},
        ${sql.json(blockedResolution)}::jsonb, ${"cd".repeat(32)},
        clock_timestamp() + interval '1 hour', null::jsonb
      ) as response
    `);
    assertEquals(blockedPrepare, { status: "rejected", reason: "offer_pending" });

    const action = await prepareFieldAction(sql, {
      playerId: fixture.playerId,
      offerId: blocked.offer_id,
      action: "accept_item",
      messageId: 7101n,
      seed: fixture.run.id,
    });
    assertEquals(
      await rpc(sql`
        select public.resolve_player_action_v2(
          ${action.token}, 950000000000000110::bigint, ${crypto.randomUUID()}::uuid,
          7101::bigint, ${action.context}
        ) as response
      `),
      { status: "rejected", reason: "actor_mismatch" },
    );
    assertEquals(
      await rpc(sql`
        select public.resolve_player_action_v2(
          ${action.token}, 950000000000000111::bigint, ${fixture.playerId}::uuid,
          7102::bigint, ${action.context}
        ) as response
      `),
      { status: "rejected", reason: "message_mismatch" },
    );
    assertEquals(
      await rpc(sql`
        select public.resolve_player_action_v2(
          ${action.token}, 950000000000000112::bigint, ${fixture.playerId}::uuid,
          7101::bigint, ${"00".repeat(32)}
        ) as response
      `),
      { status: "rejected", reason: "context_mismatch" },
    );
    const applied = await rpc(sql`
      select public.resolve_player_action_v2(
        ${action.token}, 950000000000000104::bigint, ${fixture.playerId}::uuid,
        7101::bigint, ${action.context}
      ) as response
    `);
    const replay = await rpc(sql`
      select public.resolve_player_action_v2(
        ${action.token}, 950000000000000104::bigint, ${fixture.playerId}::uuid,
        7101::bigint, ${action.context}
      ) as response
    `);
    assertEquals(applied.status, "applied");
    assertEquals(replay.status, "cached");

    const view = await rpc(sql`
      select public.run_view_v3(${fixture.playerId}::uuid, ${fixture.run.id}::uuid) as response
    `) as RpcResult & {
      run: { phase: string; stateVersion: number; stage: number; hp: number; maxHp: number };
      selfSnapshot: Record<string, number>;
    };
    assertEquals(view.run.phase, "awaiting_choice");
    assertEquals(view.run.stateVersion, 4);
    assertEquals(view.run.stage, 4);
    assertNotEquals(view.selfSnapshot, fixture.initialSelf);
    if (blocked.slot === "armor") {
      assertEquals(view.selfSnapshot.defense, fixture.initialSelf.defense + 2);
    } else {
      assertEquals(view.selfSnapshot.maxHp, fixture.initialSelf.maxHp + 4);
      assertEquals(view.run.maxHp, fixture.run.maxHp + 4);
    }

    const [state] = await sql<{
      equipment: number;
      offers: number;
      self_versions: number;
      loadout_versions: number;
      renders: number;
      next_reward_slot: string;
    }[]>`select
      (select count(*)::integer from game.player_equipment
        where player_id = ${fixture.playerId}::uuid) as equipment,
      (select count(*)::integer from game.player_offers
        where player_id = ${fixture.playerId}::uuid and offer_kind = 'field_item') as offers,
      (select count(*)::integer from game.run_self_versions
        where run_id = ${fixture.run.id}::uuid) as self_versions,
      (select count(*)::integer from game.run_loadout_versions
        where run_id = ${fixture.run.id}::uuid) as loadout_versions,
      (select count(*)::integer from game.outbox_messages
        where logical_key = format('field-offer:%s:state:4', ${fixture.run.id}::uuid)) as renders,
      (game.tutorial_reward_item_v2(${fixture.playerId}::uuid)->>'slot') as next_reward_slot`;
    assertEquals(state.equipment, 1);
    assertEquals(state.offers, 1);
    assertEquals(state.self_versions, 1);
    assertEquals(state.loadout_versions, 2);
    assertEquals(state.renders, 1);
    assertNotEquals(state.next_reward_slot, blocked.slot);
  });
});

Deno.test("discard resumes once without creating a build version", async () => {
  await withDatabase(async (sql) => {
    const fixture = await reachGuaranteedDiscovery(
      sql,
      940000000000000102n,
      "2026-09-02T07:00:00Z",
      950000000000000200n,
    );
    const [offer] = await sql<{ id: string }[]>`select id from game.player_offers
      where player_id = ${fixture.playerId}::uuid and offer_kind = 'field_item'`;
    const action = await prepareFieldAction(sql, {
      playerId: fixture.playerId,
      offerId: offer.id,
      action: "discard_item",
      messageId: 7201n,
      seed: fixture.run.id,
    });
    assertEquals(
      (await rpc(sql`
        select public.resolve_player_action_v2(
          ${action.token}, 950000000000000204::bigint, ${fixture.playerId}::uuid,
          7201::bigint, ${action.context}
        ) as response
      `)).status,
      "applied",
    );
    const [state] = await sql<{
      phase: string;
      state_version: number;
      equipment: number;
      self_versions: number;
      loadout_versions: number;
      offer_status: string;
    }[]>`select r.phase, r.state_version::integer,
      (select count(*)::integer from game.player_equipment
        where player_id = ${fixture.playerId}::uuid) as equipment,
      (select count(*)::integer from game.run_self_versions
        where run_id = r.id) as self_versions,
      (select count(*)::integer from game.run_loadout_versions
        where run_id = r.id) as loadout_versions,
      (select status from game.player_offers where id = ${offer.id}::uuid) as offer_status
      from game.runs r where r.id = ${fixture.run.id}::uuid`;
    assertEquals(state, {
      phase: "awaiting_choice",
      state_version: 4,
      equipment: 0,
      self_versions: 0,
      loadout_versions: 1,
      offer_status: "discarded",
    });
  });
});
