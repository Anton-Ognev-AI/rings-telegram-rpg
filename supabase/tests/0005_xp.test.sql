begin;
select plan(24);

select has_table('game', 'xp_accounts', 'XP accounts exist');
select has_table('game', 'player_cycle_xp_earnings', 'cycle XP cache exists');
select has_table('game', 'xp_ledger', 'append-only XP ledger exists');
select has_function('game', 'apply_xp_delta_v1', 'internal XP command exists');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'xp_accounts'),
  'XP accounts RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'player_cycle_xp_earnings'),
  'cycle XP RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'xp_ledger'),
  'XP ledger RLS is enabled');
select ok(not has_table_privilege('service_role', 'game.xp_ledger', 'insert'),
  'service role cannot directly grant XP');
select is((select balance from game.xp_accounts
  where player_id = '10000000-0000-4000-8000-000000000001'), 0::bigint,
  'synthetic player starts with zero XP');

create temporary table xp_results(label text primary key, response jsonb);
insert into xp_results values ('first', game.apply_xp_delta_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13', 100, true,
  'stage', '30000000-0000-4000-8000-000000000001', 'stage_reward',
  '00000000-0000-4000-8000-000000000001'));
select is((select (response->>'appliedDelta')::integer from xp_results where label = 'first'),
  100, 'first reward applies in full');
select is((select (response->>'cached')::boolean from xp_results where label = 'first'),
  false, 'first reward is not cached');
select is((select balance from game.xp_accounts
  where player_id = '10000000-0000-4000-8000-000000000001'), 100::bigint,
  'account balance follows ledger');
select is((select earned from game.player_cycle_xp_earnings
  where player_id = '10000000-0000-4000-8000-000000000001' and cycle_id = date '2026-07-13'),
  100, 'cycle cache follows capped earnings');

insert into xp_results values ('duplicate', game.apply_xp_delta_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13', 100, true,
  'stage', '30000000-0000-4000-8000-000000000001', 'stage_reward',
  '00000000-0000-4000-8000-000000000001'));
select is((select (response->>'cached')::boolean from xp_results where label = 'duplicate'),
  true, 'duplicate source is cached');
select is((select count(*)::integer from game.xp_ledger), 1, 'duplicate creates no ledger row');

insert into xp_results values ('cap-edge', game.apply_xp_delta_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13', 80, true,
  'stage', '30000000-0000-4000-8000-000000000002', 'stage_reward',
  '00000000-0000-4000-8000-000000000001'));
select is((select (response->>'appliedDelta')::integer from xp_results where label = 'cap-edge'),
  50, 'reward is truncated at cap edge');
select is((select (response->>'capped')::boolean from xp_results where label = 'cap-edge'),
  true, 'cap truncation is explicit');

insert into xp_results values ('at-cap', game.apply_xp_delta_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13', 10, true,
  'stage', '30000000-0000-4000-8000-000000000003', 'stage_reward',
  '00000000-0000-4000-8000-000000000001'));
select is((select (response->>'appliedDelta')::integer from xp_results where label = 'at-cap'),
  0, 'reward at cap records zero applied XP');

insert into xp_results values ('debit', game.apply_xp_delta_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13', -20, false,
  'spend', '30000000-0000-4000-8000-000000000004', 'stat_spend',
  '00000000-0000-4000-8000-000000000001'));
select is((select balance from game.xp_accounts
  where player_id = '10000000-0000-4000-8000-000000000001'), 130::bigint,
  'debit reduces balance');
select is((select earned from game.player_cycle_xp_earnings
  where player_id = '10000000-0000-4000-8000-000000000001' and cycle_id = date '2026-07-13'),
  150, 'debit does not reopen the daily earning cap');
select throws_ok(
  $$select game.apply_xp_delta_v1(
    '10000000-0000-4000-8000-000000000001', date '2026-07-13', -200, false,
    'spend', '30000000-0000-4000-8000-000000000005', 'overdraw',
    '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'overdraw is rejected');
select throws_ok($$update game.xp_ledger set applied_delta = 999$$, '55000', null,
  'ledger update is rejected');
select throws_ok($$delete from game.xp_ledger$$, '55000', null, 'ledger delete is rejected');
select is((select sum(applied_delta) from game.xp_ledger
  where player_id = '10000000-0000-4000-8000-000000000001'),
  (select balance from game.xp_accounts
  where player_id = '10000000-0000-4000-8000-000000000001'),
  'account reconciles to signed ledger sum');

select * from finish();
rollback;
