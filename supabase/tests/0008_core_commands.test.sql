begin;
select plan(36);

select has_function('public', 'start_run_v1', 'start run RPC exists');
select has_function('public', 'prepare_action_v1', 'prepare action RPC exists');
select has_function('public', 'resolve_choice_v1', 'resolve choice RPC exists');
select has_function('public', 'resume_v1', 'resume RPC exists');
select has_function('public', 'begin_identity_deletion_v1', 'begin deletion RPC exists');
select has_function('public', 'finalize_identity_deletion_v1', 'finalize deletion RPC exists');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n
  on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
    'start_run_v1', 'prepare_action_v1', 'resolve_choice_v1', 'resume_v1',
    'begin_identity_deletion_v1', 'finalize_identity_deletion_v1') and p.prosecdef),
  6, 'all command RPCs are security definer');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n
  on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
    'start_run_v1', 'prepare_action_v1', 'resolve_choice_v1', 'resume_v1',
    'begin_identity_deletion_v1', 'finalize_identity_deletion_v1')
    and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']),
  6, 'all command RPCs pin safe search_path');
select ok(has_function_privilege('service_role', 'public.resume_v1(uuid)', 'execute'),
  'service role can execute explicit RPC');
select ok(not has_function_privilege('anon', 'public.resume_v1(uuid)', 'execute'),
  'anon cannot execute command RPC');

create temporary table command_results(label text primary key, response jsonb);
insert into command_results values ('start', public.start_run_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13',
  '{"maxHp":40,"physical":5,"magical":5,"agility":5,"vitality":5,"defense":5,
    "vampRateBps":0,"postHeal":0}'::jsonb, repeat('a', 64),
  '{"items":[],"rings":[]}'::jsonb, repeat('b', 64)));
select is((select response->>'status' from command_results where label = 'start'),
  'applied', 'start run applies');
select is((select count(*)::integer from game.runs), 1, 'start inserts one run');
select is((select count(*)::integer from game.run_self_snapshots), 1,
  'start pins one self snapshot');
select is((select count(*)::integer from game.run_loadout_versions), 1,
  'start pins one loadout version');
select is((select (public.resume_v1('10000000-0000-4000-8000-000000000001')->'run'->>'stage')::integer),
  1, 'resume projects current stage');

insert into command_results values ('prepare-primary', public.prepare_action_v1(
  '10000000-0000-4000-8000-000000000001',
  (select id from game.runs limit 1), repeat('c', 64), 0::bigint, 1::smallint, 0::smallint,
  's1-neutral', repeat('d', 64),
  '{"resolverVersion":"v1","stage":1,"exchange":null,"choiceId":"s1-neutral",
    "outcome":"neutral","hp":{"before":40,"damage":2,"vampHeal":0,"postHeal":0,"after":38},
    "bossHp":null,"xp":{"before":0,"delta":2,"after":2},"terminal":null,
    "nextStage":2,"nextExchange":null}'::jsonb,
  repeat('e', 64), clock_timestamp() + interval '1 hour'));
select is((select response->>'status' from command_results where label = 'prepare-primary'),
  'ok', 'primary action is prepared');
select is((select count(*)::integer from game.action_tokens), 1, 'one prepared token is stored');
insert into command_results values ('prepare-cached', public.prepare_action_v1(
  '10000000-0000-4000-8000-000000000001',
  (select id from game.runs limit 1), repeat('c', 64), 0::bigint, 1::smallint, 0::smallint,
  's1-neutral', repeat('d', 64),
  '{"resolverVersion":"v1","stage":1,"exchange":null,"choiceId":"s1-neutral",
    "outcome":"neutral","hp":{"before":40,"damage":2,"vampHeal":0,"postHeal":0,"after":38},
    "bossHp":null,"xp":{"before":0,"delta":2,"after":2},"terminal":null,
    "nextStage":2,"nextExchange":null}'::jsonb,
  repeat('e', 64), (select expires_at from game.action_tokens where token_sha256 = repeat('c', 64))));
select is((select response->>'status' from command_results where label = 'prepare-cached'),
  'cached', 'identical prepare is idempotent');

insert into command_results values ('prepare-stale', public.prepare_action_v1(
  '10000000-0000-4000-8000-000000000001',
  (select id from game.runs limit 1), repeat('f', 64), 0::bigint, 1::smallint, 0::smallint,
  's1-risk', repeat('d', 64),
  '{"resolverVersion":"v1","stage":1,"exchange":null,"choiceId":"s1-risk",
    "outcome":"failure","hp":{"before":40,"damage":5,"vampHeal":0,"postHeal":0,"after":35},
    "bossHp":null,"xp":{"before":0,"delta":0,"after":0},"terminal":null,
    "nextStage":2,"nextExchange":null}'::jsonb,
  repeat('1', 64), clock_timestamp() + interval '1 hour'));

insert into command_results values ('tampered', public.resolve_choice_v1(
  repeat('c', 64), 700000000000000010,
  '10000000-0000-4000-8000-000000000099', repeat('d', 64)));
select is((select response->>'status' from command_results where label = 'tampered'),
  'rejected', 'tampered actor is rejected');
select is((select state_version from game.runs), 0::bigint, 'rejected action changes no run state');

insert into command_results values ('applied', public.resolve_choice_v1(
  repeat('c', 64), 700000000000000011,
  '10000000-0000-4000-8000-000000000001', repeat('d', 64)));
select is((select response->>'status' from command_results where label = 'applied'),
  'applied', 'valid action applies');
select is((select state_version from game.runs), 1::bigint, 'run version increments once');
select is((select hp from game.runs), 38, 'prepared HP result applies');
select is((select xp_earned from game.runs), 2, 'run XP applies');
select is((select count(*)::integer from game.xp_ledger), 1, 'one XP ledger row applies');
select is((select count(*)::integer from game.run_stage_results), 1, 'one stage result applies');
select is((select count(*)::integer from game.outbox_messages), 1, 'one outbox intent applies');
select is((select count(*)::integer from game.processed_actions), 1, 'one processed cache row applies');

insert into command_results values ('replay', public.resolve_choice_v1(
  repeat('c', 64), 700000000000000012,
  '10000000-0000-4000-8000-000000000001', repeat('d', 64)));
select is((select response->>'status' from command_results where label = 'replay'),
  'cached', 'processed token returns cached before stale checks');
select is((select response->'result'->>'status' from command_results where label = 'replay'),
  'applied', 'cached response preserves original logical result');
select is((select count(*)::integer from game.outbox_messages), 1,
  'replay creates no second outbox row');
select is((select count(*)::integer from game.xp_ledger), 1,
  'replay creates no second ledger row');

insert into command_results values ('stale', public.resolve_choice_v1(
  repeat('f', 64), 700000000000000013,
  '10000000-0000-4000-8000-000000000001', repeat('d', 64)));
select is((select response->>'status' from command_results where label = 'stale'),
  'stale', 'competing old-version token becomes stale');
select is((select count(*)::integer from game.processed_actions), 1,
  'stale action does not create processed effect cache');

set local role anon;
select throws_ok($$select public.resume_v1('10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon RPC execution is denied under impersonation');
reset role;
set local role service_role;
select lives_ok($$select public.resume_v1('10000000-0000-4000-8000-000000000001')$$,
  'service role RPC works without private schema usage');
reset role;

select * from finish();
rollback;
