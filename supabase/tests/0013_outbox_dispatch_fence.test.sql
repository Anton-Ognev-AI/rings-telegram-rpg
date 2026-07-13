begin;
select plan(20);

select has_column('game', 'outbox_messages', 'dispatch_started_at',
  'outbox stores a durable dispatch marker');
select has_function('public', 'lease_outbox_v3',
  array['uuid', 'integer', 'integer', 'timestamp with time zone'],
  'dispatch-safe lease RPC exists');
select has_function('public', 'authorize_outbox_delivery_v2',
  array['uuid', 'uuid', 'boolean', 'integer', 'timestamp with time zone'],
  'dispatch authorization RPC exists');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'lease_outbox_v3', 'authorize_outbox_delivery_v2') and p.prosecdef),
  2, 'dispatch fence RPCs are security definer');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'lease_outbox_v3', 'authorize_outbox_delivery_v2')
    and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']),
  2, 'dispatch fence RPCs pin the safe search path');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname in (
    'lease_outbox_v3', 'authorize_outbox_delivery_v2') and r.rolname = 'postgres'),
  2, 'postgres owns dispatch fence RPCs');
select ok(has_function_privilege('service_role',
  'public.lease_outbox_v3(uuid,integer,integer,timestamp with time zone)', 'execute'),
  'service role can lease through the dispatch fence');
select ok(has_function_privilege('service_role',
  'public.authorize_outbox_delivery_v2(uuid,uuid,boolean,integer,timestamp with time zone)',
  'execute'), 'service role can arm a dispatch');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'lease_outbox_v3', 'authorize_outbox_delivery_v2')
    and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon cannot execute dispatch fence RPCs');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'lease_outbox_v3', 'authorize_outbox_delivery_v2')
    and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'authenticated cannot execute dispatch fence RPCs');

create temporary table dispatch_results(label text primary key, response jsonb);
insert into dispatch_results values ('start', public.start_run_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13',
  '{"maxHp":40,"physical":5,"magical":5,"agility":5,"vitality":5,"defense":5,
    "vampRateBps":0,"postHeal":0}'::jsonb, repeat('e', 64),
  '{"items":[],"rings":[]}'::jsonb, repeat('f', 64)));
select is((select response->>'status' from dispatch_results where label = 'start'),
  'applied', 'fixture run starts');
insert into game.outbox_messages(logical_key, intent_type, payload)
select 'dispatch:queued', 'render_run_state',
  jsonb_build_object('runId', id, 'stateVersion', state_version)
from game.runs where player_id = '10000000-0000-4000-8000-000000000001';
insert into dispatch_results values ('lease', public.lease_outbox_v3(
  '83000000-0000-4000-8000-000000000001', 1, 30, '2099-07-13T12:00:00Z'));
select is(jsonb_array_length((select response->'messages' from dispatch_results
  where label = 'lease')), 1, 'new card is leased once');
insert into dispatch_results values ('authorize', public.authorize_outbox_delivery_v2(
  ((select response->'messages'->0->>'id' from dispatch_results where label = 'lease'))::uuid,
  ((select response->'messages'->0->>'leaseId' from dispatch_results where label = 'lease'))::uuid,
  true, 5, '2099-07-13T12:00:01Z'));
select is((select response->>'status' from dispatch_results where label = 'authorize'),
  'ok', 'new send dispatch is armed');
select is((select response->>'deliveryDeadline' from dispatch_results where label = 'authorize'),
  '2099-07-13T12:00:06+00:00', 'authorization renews a bounded lease');
select is((select dispatch_started_at::text from game.outbox_messages
  where logical_key = 'dispatch:queued'), '2099-07-13 12:00:01+00',
  'dispatch marker is durable before transport');
select is((public.authorize_outbox_delivery_v2(
  ((select response->'messages'->0->>'id' from dispatch_results where label = 'lease'))::uuid,
  ((select response->'messages'->0->>'leaseId' from dispatch_results where label = 'lease'))::uuid,
  false, 5, '2099-07-13T12:00:02Z')->>'reason'),
  'send_mode_mismatch', 'database rejects a forged edit mode');
insert into dispatch_results values ('after-crash', public.lease_outbox_v3(
  '83000000-0000-4000-8000-000000000002', 50, 30, '2099-07-13T12:00:07Z'));
select is(jsonb_array_length((select response->'messages' from dispatch_results
  where label = 'after-crash')), 0, 'expired armed send is never blindly re-leased');
select is((select status::text from game.outbox_messages
  where logical_key = 'dispatch:queued'), 'delivery_unknown',
  'crash after dispatch becomes delivery unknown');
select is(jsonb_array_length(public.lease_outbox_v3(
  '83000000-0000-4000-8000-000000000003', 50, 30,
  '2099-07-13T12:01:00Z')->'messages'), 0,
  'delivery unknown remains terminal on later lease cycles');
select is((public.complete_outbox_v1(
  ((select response->'messages'->0->>'id' from dispatch_results where label = 'lease'))::uuid,
  ((select response->'messages'->0->>'leaseId' from dispatch_results where label = 'lease'))::uuid,
  'delivery_unknown', null, null, '2099-07-13T12:00:07Z')->>'status'),
  'cached', 'late worker completion is idempotent');

select * from finish();
rollback;
