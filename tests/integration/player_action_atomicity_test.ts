import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { RpcResult } from "./helpers/database.ts";
import { createFixture, prepare } from "./helpers/database.ts";

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

Deno.test("a stat purchase spends exact XP and replays without a second effect", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000011::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    await sql`select game.apply_xp_delta_v1(
      ${playerId}::uuid, '2026-08-15'::date, 20, false,
      'test_grant', '94000000-0000-4000-8000-000000000011'::uuid,
      'phase4_atomicity_fixture', '00000000-0000-4000-8000-000000000001'::uuid
    )`;

    const token = "a".repeat(64);
    const context = "b".repeat(64);
    const prepared = await rpc(sql`
      select public.prepare_player_action_v1(
        ${playerId}::uuid, ${token}, 0::bigint, 7001::bigint,
        '{"kind":"buy_stat","stat":"physical"}'::jsonb,
        ${context}, clock_timestamp() + interval '1 hour'
      ) as response
    `);
    assertEquals(prepared.status, "ok");

    const applied = await rpc(sql`
      select public.resolve_player_action_v1(
        ${token}, 940000000000001001::bigint, ${playerId}::uuid, 7001::bigint, ${context}
      ) as response
    `);
    const replay = await rpc(sql`
      select public.resolve_player_action_v1(
        ${token}, 940000000000001001::bigint, ${playerId}::uuid, 7001::bigint, ${context}
      ) as response
    `);
    assertEquals(applied.status, "applied");
    assertEquals(replay.status, "cached");

    const [effects] = await sql<
      { physical: number; purchased: number; balance: number; ledger: number; processed: number }[]
    >`select
      ps.physical::integer,
      psp.physical_purchased::integer as purchased,
      xa.balance::integer,
      (select count(*)::integer from game.xp_ledger
        where player_id = ${playerId}::uuid and reason = 'buy_stat_physical') as ledger,
      (select count(*)::integer from game.processed_player_actions
        where player_id = ${playerId}::uuid) as processed
    from game.player_stats ps
    join game.player_stat_progression psp using (player_id)
    join game.xp_accounts xa using (player_id)
    where ps.player_id = ${playerId}::uuid`;
    assertEquals(effects, { physical: 6, purchased: 1, balance: 0, ledger: 1, processed: 1 });
  });
});

Deno.test("third vitality purchase adds HP and the every-third defense bonus", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000012::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    await sql`update game.player_stat_progression set vitality_purchased = 2
      where player_id = ${playerId}::uuid`;
    await sql`update game.player_stats set vitality = vitality + 2, max_hp = max_hp + 8
      where player_id = ${playerId}::uuid`;
    await sql`select game.apply_xp_delta_v1(
      ${playerId}::uuid, '2026-08-15'::date, 40, false,
      'test_grant', '94000000-0000-4000-8000-000000000012'::uuid,
      'phase4_vitality_fixture', '00000000-0000-4000-8000-000000000001'::uuid
    )`;
    const prepared = await rpc(sql`select public.prepare_player_action_v1(
      ${playerId}::uuid, ${"0".repeat(64)}, 0, 7012,
      '{"kind":"buy_stat","stat":"vitality"}'::jsonb,
      ${"a1".repeat(32)}, clock_timestamp() + interval '1 hour'
    ) as response`);
    assertEquals(prepared.status, "ok");
    const applied = await rpc(sql`select public.resolve_player_action_v1(
      ${"0".repeat(64)}, 940000000000001002, ${playerId}::uuid, 7012, ${"a1".repeat(32)}
    ) as response`);
    assertEquals(applied.status, "applied");

    const [effect] = await sql<{
      vitality: number;
      max_hp: number;
      defense: number;
      purchased: number;
      balance: number;
    }[]>`select s.vitality, s.max_hp, s.defense,
      p.vitality_purchased::integer as purchased, x.balance::integer
      from game.player_stats s
      join game.player_stat_progression p using (player_id)
      join game.xp_accounts x using (player_id)
      where s.player_id = ${playerId}::uuid`;
    assertEquals(effect, { vitality: 8, max_hp: 52, defense: 6, purchased: 3, balance: 0 });
  });
});

Deno.test("defer, item replacement and ring choice form one ordered no-inventory flow", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000013::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    const deferred = await rpc(sql`select public.prepare_player_action_v1(
      ${playerId}::uuid, ${"e".repeat(64)}, 0, 7013,
      '{"kind":"defer_stat"}'::jsonb, ${"f".repeat(64)},
      clock_timestamp() + interval '1 hour'
    ) as response`);
    assertEquals(deferred.status, "ok");
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${"e".repeat(64)}, 940000000000001003, ${playerId}::uuid, 7013, ${"f".repeat(64)}
    ) as response`)).status,
      "applied",
    );
    await sql`update game.player_onboarding set tutorial_completed = 1
      where player_id = ${playerId}::uuid`;

    await rpc(sql`
      select public.publish_fallback_day_v1('2026-08-21T07:00:00Z'::timestamptz) as response
    `);
    await rpc(sql`select public.advance_day_v2('2026-08-21T07:00:00Z'::timestamptz) as response`);
    const started = await rpc(sql`select public.start_run_v3(
      ${playerId}::uuid, '2026-08-21T07:00:00Z'::timestamptz
    ) as response`);
    const runId = String((started.projection as { run: { id: string } }).run.id);
    const [offers] = await sql<{ item_id: string; ring_id: string }[]>`
      with item as (
        insert into game.player_offers(player_id, source_run_id, sequence, offer_kind, payload)
        values (${playerId}::uuid, ${runId}::uuid, 1, 'tutorial_item',
          '{"itemKey":"training_armor","slot":"armor","rarity":"ordinary","bonuses":{"defense":2}}')
        returning id
      ), ring as (
        insert into game.player_offers(player_id, source_run_id, sequence, offer_kind, payload)
        values (${playerId}::uuid, ${runId}::uuid, 2, 'starter_ring',
          '{"color":"blue","rarity":"ordinary","choices":["weapon","fire","defense","healing"]}')
        returning id
      ) select item.id as item_id, ring.id as ring_id from item cross join ring`;

    const itemPrepared = await rpc(sql`select public.prepare_player_action_v1(
      ${playerId}::uuid, ${"1".repeat(64)}, 1, 7013,
      ${sql.json({ kind: "accept_item", offerId: offers.item_id })}::jsonb,
      ${"2".repeat(64)}, clock_timestamp() + interval '1 hour'
    ) as response`);
    assertEquals(itemPrepared.status, "ok");
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${"1".repeat(64)}, 940000000000001004, ${playerId}::uuid, 7013, ${"2".repeat(64)}
    ) as response`)).status,
      "applied",
    );

    const ringPrepared = await rpc(sql`select public.prepare_player_action_v1(
      ${playerId}::uuid, ${"3".repeat(64)}, 2, 7013,
      ${sql.json({ kind: "choose_ring", offerId: offers.ring_id, ringKind: "fire" })}::jsonb,
      ${"4".repeat(64)}, clock_timestamp() + interval '1 hour'
    ) as response`);
    assertEquals(ringPrepared.status, "ok");
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${"3".repeat(64)}, 940000000000001005, ${playerId}::uuid, 7013, ${"4".repeat(64)}
    ) as response`)).status,
      "applied",
    );

    const [state] = await sql<{
      initial_training_resolved: boolean;
      tutorial_completed: number;
      academy_rank: string;
      profile_version: number;
      armor: string;
      main_item: string;
      ring_kind: string;
      color: string;
      mastery_percent: number;
      invested_xp: number;
      accepted_offers: number;
    }[]>`select
      o.initial_training_resolved_at is not null as initial_training_resolved,
      o.tutorial_completed::integer, o.academy_rank, o.profile_version::integer,
      (select item_key from game.player_equipment
        where player_id = o.player_id and slot = 'armor') as armor,
      (select item_key from game.player_equipment
        where player_id = o.player_id and slot = 'main') as main_item,
      r.ring_kind, r.color, r.mastery_percent, r.invested_xp::integer,
      (select count(*)::integer from game.player_offers
        where player_id = o.player_id and status = 'accepted') as accepted_offers
      from game.player_onboarding o
      join game.player_rings r using (player_id)
      where o.player_id = ${playerId}::uuid`;
    assertEquals(state, {
      initial_training_resolved: true,
      tutorial_completed: 2,
      academy_rank: "novice",
      profile_version: 3,
      armor: "training_armor",
      main_item: "apprentice_focus",
      ring_kind: "fire",
      color: "blue",
      mastery_percent: 0,
      invested_xp: 0,
      accepted_offers: 2,
    });
  });
});

Deno.test("mastery spends 20 XP for one percent without changing blue combat policy", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000014::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    await sql`update game.player_onboarding set tutorial_completed = 2, academy_rank = 'novice'
      where player_id = ${playerId}::uuid`;
    await sql`insert into game.player_rings(
      player_id, ring_kind, progression_config_id
    ) values (
      ${playerId}::uuid, 'defense', '00000000-0000-4000-8000-000000000002'::uuid
    )`;
    await sql`select game.apply_xp_delta_v1(
      ${playerId}::uuid, '2026-08-15', 20, false, 'test_grant',
      '94000000-0000-4000-8000-000000000014'::uuid, 'phase4_mastery_fixture',
      '00000000-0000-4000-8000-000000000001'::uuid
    )`;
    assertEquals(
      (await rpc(sql`select public.prepare_player_action_v1(
      ${playerId}::uuid, ${"5".repeat(64)}, 0, 7014,
      '{"kind":"train_ring_mastery"}', ${"6".repeat(64)},
      clock_timestamp() + interval '1 hour'
    ) as response`)).status,
      "ok",
    );
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${"5".repeat(64)}, 940000000000001006, ${playerId}::uuid, 7014, ${"6".repeat(64)}
    ) as response`)).status,
      "applied",
    );

    const [state] = await sql<{
      mastery_percent: number;
      invested_xp: number;
      balance: number;
      combat_bps: number;
    }[]>`select r.mastery_percent, r.invested_xp::integer, x.balance::integer,
      (c.payload#>>'{blueRing,combatBps}')::integer as combat_bps
      from game.player_rings r join game.xp_accounts x using (player_id)
      join game.progression_config_versions c on c.id = r.progression_config_id
      where r.player_id = ${playerId}::uuid`;
    assertEquals(state, { mastery_percent: 1, invested_xp: 20, balance: 0, combat_bps: 1500 });
  });
});

Deno.test("discard gives no compensation and a defensive ring uses the tie-break weapon", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createFixture(sql, {
      playerId: "94000000-0000-4000-8000-000000000016",
      cycleId: "2026-08-23",
      telegramId: 940000000000000016n,
    });
    await rpc(sql`
      select public.telegram_identity_v2(940000000000000016::bigint, false) as response
    `);
    await sql`update game.player_onboarding set tutorial_completed = 1
      where player_id = ${fixture.playerId}::uuid`;
    const [offers] = await sql<{ item_id: string; ring_id: string }[]>`
      with item as (
        insert into game.player_offers(player_id, source_run_id, sequence, offer_kind, payload)
        values (${fixture.playerId}::uuid, ${fixture.runId}::uuid, 1, 'tutorial_item',
          '{"itemKey":"training_armor","slot":"armor","rarity":"ordinary","bonuses":{"defense":2}}')
        returning id
      ), ring as (
        insert into game.player_offers(player_id, source_run_id, sequence, offer_kind, payload)
        values (${fixture.playerId}::uuid, ${fixture.runId}::uuid, 2, 'starter_ring',
          '{"color":"blue","rarity":"ordinary","choices":["weapon","fire","defense","healing"]}')
        returning id
      ) select item.id as item_id, ring.id as ring_id from item cross join ring`;
    const discardToken = "ab".repeat(32);
    const discardContext = "bc".repeat(32);
    await rpc(sql`select public.prepare_player_action_v1(
      ${fixture.playerId}::uuid, ${discardToken}, 0, 7016,
      ${sql.json({ kind: "discard_item", offerId: offers.item_id })}::jsonb,
      ${discardContext}, clock_timestamp() + interval '1 hour'
    ) as response`);
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${discardToken}, 940000000000001008, ${fixture.playerId}::uuid, 7016,
      ${discardContext}
    ) as response`)).status,
      "applied",
    );
    const ringToken = "cd".repeat(32);
    const ringContext = "de".repeat(32);
    await rpc(sql`select public.prepare_player_action_v1(
      ${fixture.playerId}::uuid, ${ringToken}, 1, 7016,
      ${sql.json({ kind: "choose_ring", offerId: offers.ring_id, ringKind: "defense" })}::jsonb,
      ${ringContext}, clock_timestamp() + interval '1 hour'
    ) as response`);
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${ringToken}, 940000000000001009, ${fixture.playerId}::uuid, 7016,
      ${ringContext}
    ) as response`)).status,
      "applied",
    );

    const [effect] = await sql<{
      discarded: number;
      equipment_count: number;
      main_item: string;
      ring_kind: string;
      balance: number;
    }[]>`select
      (select count(*)::integer from game.player_offers
        where player_id = ${fixture.playerId}::uuid and status = 'discarded') as discarded,
      (select count(*)::integer from game.player_equipment
        where player_id = ${fixture.playerId}::uuid and slot <> 'main') as equipment_count,
      (select item_key from game.player_equipment
        where player_id = ${fixture.playerId}::uuid and slot = 'main') as main_item,
      (select ring_kind from game.player_rings
        where player_id = ${fixture.playerId}::uuid) as ring_kind,
      (select balance::integer from game.xp_accounts
        where player_id = ${fixture.playerId}::uuid) as balance`;
    assertEquals(effect, {
      discarded: 1,
      equipment_count: 0,
      main_item: "training_sword",
      ring_kind: "defense",
      balance: 0,
    });
  });
});

Deno.test("one Telegram update cannot mutate run and profile namespaces", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createFixture(sql, {
      playerId: "94000000-0000-4000-8000-000000000015",
      cycleId: "2026-08-22",
      telegramId: 940000000000000015n,
    });
    await rpc(sql`
      select public.telegram_identity_v2(940000000000000015::bigint, false) as response
    `);
    await sql`select game.apply_xp_delta_v1(
      ${fixture.playerId}::uuid, '2026-08-22', 20, false, 'test_grant',
      '94000000-0000-4000-8000-000000000016'::uuid, 'cross_namespace_fixture',
      '00000000-0000-4000-8000-000000000001'::uuid
    )`;
    const runAction = await prepare(sql, fixture, "cross-namespace");
    const profileToken = "7".repeat(64);
    const profileContext = "8".repeat(64);
    await rpc(sql`select public.prepare_player_action_v1(
      ${fixture.playerId}::uuid, ${profileToken}, 0, 7015,
      '{"kind":"buy_stat","stat":"magical"}', ${profileContext},
      clock_timestamp() + interval '1 hour'
    ) as response`);
    const updateId = 940000000000001007n;
    assertEquals(
      (await rpc(sql`select public.resolve_player_action_v1(
      ${profileToken}, ${updateId.toString()}::bigint, ${fixture.playerId}::uuid,
      7015, ${profileContext}
    ) as response`)).status,
      "applied",
    );
    const rejected = await rpc(sql`select public.resolve_choice_v2(
      ${runAction.token}, ${updateId.toString()}::bigint,
      ${fixture.playerId}::uuid, ${runAction.context}
    ) as response`);
    assertEquals(rejected, { status: "rejected", reason: "update_id_conflict" });
    const [effects] = await sql<{ magical: number; stage_results: number }[]>`select
      s.magical,
      (select count(*)::integer from game.run_stage_results where run_id = ${fixture.runId}::uuid)
        as stage_results
      from game.player_stats s where player_id = ${fixture.playerId}::uuid`;
    assertEquals(effects, { magical: 6, stage_results: 0 });
  });
});

Deno.test("invalid Telegram callback identifiers are rejected without consuming the action", async () => {
  await withDatabase(async (sql) => {
    const identity = await rpc(sql`
      select public.telegram_identity_v2(940000000000000017::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    const token = "ef".repeat(32);
    const context = "a".repeat(64);
    await rpc(sql`select public.prepare_player_action_v1(
      ${playerId}::uuid, ${token}, 0, 7017,
      '{"kind":"defer_stat"}'::jsonb, ${context},
      clock_timestamp() + interval '1 hour'
    ) as response`);

    const invalidUpdate = await rpc(sql`select public.resolve_player_action_v1(
      ${token}, 0, ${playerId}::uuid, 7017, ${context}
    ) as response`);
    const invalidMessage = await rpc(sql`select public.resolve_player_action_v1(
      ${token}, 940000000000001010, ${playerId}::uuid, 0, ${context}
    ) as response`);
    assertEquals(invalidUpdate, { status: "rejected", reason: "invalid_binding" });
    assertEquals(invalidMessage, { status: "rejected", reason: "invalid_binding" });

    const [state] = await sql<{ consumed: boolean; processed: number }[]>`select
      consumed_at is not null as consumed,
      (select count(*)::integer from game.processed_player_actions
        where token_sha256 = ${token}) as processed
      from game.player_action_tokens where token_sha256 = ${token}`;
    assertEquals(state, { consumed: false, processed: 0 });
  });
});
