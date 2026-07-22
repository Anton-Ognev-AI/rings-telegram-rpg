begin;
select plan(21);

select has_table('game', 'run_self_versions',
  'effective run self snapshots have an append-only version table');
select columns_are(
  'game', 'run_self_versions',
  array['run_id', 'version', 'snapshot', 'snapshot_sha256', 'source_offer_id', 'created_at'],
  'effective self versions expose only the pinned contract columns'
);
select col_is_pk(
  'game', 'run_self_versions', array['run_id', 'version']::name[],
  'effective self version is unique within its run'
);
select has_trigger(
  'game', 'run_self_versions', 'run_self_versions_immutable',
  'effective self versions are immutable'
);
select is((select count(*)::integer
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'game' and c.relname = 'run_self_versions' and c.relrowsecurity),
  1, 'effective self versions enable RLS');
select is((select count(*)::integer
  from information_schema.table_privileges
  where table_schema = 'game' and table_name = 'run_self_versions'
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  0, 'API roles have no direct effective-snapshot access');
select ok(exists(
  select 1 from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'game'
    and c.relname = 'player_offers_one_field_discovery_per_player_idx'
    and i.indisunique
    and pg_get_expr(i.indpred, i.indrelid) like '%field_item%'
), 'a player can receive at most one tutorial field discovery');

select has_function('game', 'field_discovery_chance_v1',
  'private protected-chance helper exists');
select has_function('game', 'field_discovery_roll_v1',
  'private deterministic-roll helper exists');
select has_function('game', 'field_discovery_slot_v1',
  'private deterministic-slot helper exists');
select is(game.field_discovery_chance_v1(1, 'success'), 30,
  'stage-one success uses the pinned 30 percent chance');
select is(game.field_discovery_chance_v1(2, 'failure'), 30,
  'stage-two failure uses the pinned 30 percent chance');
select is(game.field_discovery_chance_v1(3, 'failure'), 100,
  'stage three is the pity boundary');
select is(game.field_discovery_roll_v1(
  '20000000-0000-4000-8000-000000000001'::uuid, 1, 'success'), 4,
  'SQL discovery roll matches the pinned TypeScript vector');
select is(game.field_discovery_slot_v1(
  '20000000-0000-4000-8000-000000000001'::uuid), 'talisman',
  'SQL slot selector matches the pinned TypeScript vector');
select ok(position('game.tutorial_reward_item_v2' in
  pg_get_functiondef('game.credit_tutorial_run_v1(uuid,timestamptz)'::regprocedure)) > 0,
  'second tutorial credit selects the still-empty support slot');

select has_function('public', 'prepare_action_v3',
  'offer-fenced action preparation exists');
select has_function('public', 'resolve_choice_v3',
  'discovery-aware choice resolution exists');
select has_function('public', 'run_view_v3',
  'effective-build run view exists');
select has_function('public', 'resolve_player_action_v2',
  'field-item profile action resolution exists');
select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('prepare_action_v3', 'resolve_choice_v3', 'run_view_v3',
      'resolve_player_action_v2')
    and p.prosecdef
    and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute')),
  4, 'new public RPCs pin search_path and expose only service-role execution');

select * from finish();
rollback;
