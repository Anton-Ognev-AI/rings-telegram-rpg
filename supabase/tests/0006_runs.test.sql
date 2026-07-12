begin;
select plan(22);

select has_table('game', 'runs', 'runs exist');
select has_table('game', 'run_self_snapshots', 'self snapshots exist');
select has_table('game', 'run_loadout_versions', 'loadout versions exist');
select has_table('game', 'run_stage_results', 'stage results exist');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'runs'),
  'runs RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'run_self_snapshots'),
  'self snapshots RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'run_loadout_versions'),
  'loadout snapshots RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'run_stage_results'),
  'stage results RLS is enabled');
select ok(not has_table_privilege('service_role', 'game.runs', 'insert'),
  'service role cannot directly create runs');

insert into game.runs (
  id, player_id, cycle_id, content_version_id, config_version_id,
  status, phase, state_version, stage, exchange, hp, max_hp, boss_hp, xp_earned
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', date '2026-07-13',
  '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  'active', 'awaiting_choice', 0, 1, null, 40, 40, null, 0
);
select is((select state_version from game.runs where id = '40000000-0000-4000-8000-000000000001'),
  0::bigint, 'run starts at state version zero');
select is((select hp from game.runs where id = '40000000-0000-4000-8000-000000000001'),
  40, 'run starts at snapshot HP');

insert into game.run_self_snapshots(run_id, snapshot, snapshot_sha256) values (
  '40000000-0000-4000-8000-000000000001', '{"maxHp":40}'::jsonb, repeat('a', 64));
insert into game.run_loadout_versions(run_id, version, snapshot, snapshot_sha256) values (
  '40000000-0000-4000-8000-000000000001', 1, '{"items":[]}'::jsonb, repeat('b', 64));
select is((select version from game.run_loadout_versions
  where run_id = '40000000-0000-4000-8000-000000000001'), 1,
  'first loadout version is pinned');
select throws_ok($$update game.run_self_snapshots set snapshot = '{}'::jsonb$$,
  '55000', null, 'self snapshot is immutable');
select throws_ok($$update game.run_loadout_versions set snapshot = '{}'::jsonb$$,
  '55000', null, 'loadout snapshot is immutable');

insert into game.run_stage_results (
  run_id, stage, exchange, choice_id, resolution, resolution_sha256
) values (
  '40000000-0000-4000-8000-000000000001', 1, 0, 's1-neutral',
  '{"outcome":"neutral"}'::jsonb, repeat('c', 64));
select throws_ok($$insert into game.run_stage_results (
    run_id, stage, exchange, choice_id, resolution, resolution_sha256
  ) values (
    '40000000-0000-4000-8000-000000000001', 1, 0, 'duplicate', '{}'::jsonb, repeat('d', 64)
  )$$, '23505', null, 'one result exists per stage exchange');
select throws_ok($$update game.run_stage_results set choice_id = 'forged'$$,
  '55000', null, 'stage result is immutable');
select throws_ok($$update game.runs set hp = 41
  where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'HP cannot exceed max HP');
select throws_ok($$update game.runs set stage = 10, exchange = null
  where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'boss stage requires an exchange');
select throws_ok($$update game.runs set status = 'defeated'
  where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'terminal run requires finished_at');

insert into game.dungeon_days (
  cycle_id, content_version_id, opens_at, closes_at, grace_ends_at, status
) values (
  date '2026-07-14', '20000000-0000-4000-8000-000000000001',
  ((date '2026-07-14' + time '09:00') at time zone 'Europe/Kyiv'),
  ((date '2026-07-15' + time '09:00') at time zone 'Europe/Kyiv'),
  ((date '2026-07-15' + time '11:00') at time zone 'Europe/Kyiv'), 'fallback_ready'
);
select throws_ok($$insert into game.runs (
    id, player_id, cycle_id, content_version_id, config_version_id,
    status, phase, state_version, stage, hp, max_hp, xp_earned
  ) values (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001', date '2026-07-14',
    '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'active', 'awaiting_choice', 0, 1, 40, 40, 0
  )$$, '23505', null, 'a player has at most one active run across cycles');
select lives_ok($$update game.runs set status = 'abandoned', finished_at = clock_timestamp()
  where id = '40000000-0000-4000-8000-000000000001'$$,
  'valid terminal transition records finished_at');
select is((select status::text from game.runs where id = '40000000-0000-4000-8000-000000000001'),
  'abandoned', 'terminal status persists');

select * from finish();
rollback;
