begin;
select plan(32);

select has_function('public', 'begin_identity_deletion_v2',
  array['uuid', 'uuid', 'timestamp with time zone'], 'fenced deletion begin RPC exists');
select has_function('public', 'lease_outbox_v2',
  array['uuid', 'integer', 'integer', 'timestamp with time zone'],
  'identity-safe outbox lease RPC exists');
select has_function('public', 'authorize_outbox_delivery_v1',
  array['uuid', 'uuid', 'timestamp with time zone'], 'delivery authorization RPC exists');
select has_function('public', 'finalize_identity_deletion_v2',
  array['uuid', 'uuid', 'timestamp with time zone'], 'fenced deletion finalize RPC exists');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'begin_identity_deletion_v2', 'lease_outbox_v2',
    'authorize_outbox_delivery_v1', 'finalize_identity_deletion_v2') and p.prosecdef),
  4, 'all fence RPCs are security definer');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'begin_identity_deletion_v2', 'lease_outbox_v2',
    'authorize_outbox_delivery_v1', 'finalize_identity_deletion_v2')
    and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']),
  4, 'all fence RPCs pin the safe search path');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname in (
    'begin_identity_deletion_v2', 'lease_outbox_v2',
    'authorize_outbox_delivery_v1', 'finalize_identity_deletion_v2')
    and r.rolname = 'postgres'), 4, 'postgres owns every fence RPC');

select ok(has_function_privilege('service_role',
  'public.begin_identity_deletion_v2(uuid,uuid,timestamp with time zone)', 'execute'),
  'service role can begin fenced deletion');
select ok(has_function_privilege('service_role',
  'public.lease_outbox_v2(uuid,integer,integer,timestamp with time zone)', 'execute'),
  'service role can lease through the identity fence');
select ok(has_function_privilege('service_role',
  'public.authorize_outbox_delivery_v1(uuid,uuid,timestamp with time zone)', 'execute'),
  'service role can authorize an exact delivery');
select ok(has_function_privilege('service_role',
  'public.finalize_identity_deletion_v2(uuid,uuid,timestamp with time zone)', 'execute'),
  'service role can finalize fenced deletion');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'begin_identity_deletion_v2', 'lease_outbox_v2',
    'authorize_outbox_delivery_v1', 'finalize_identity_deletion_v2')
    and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon cannot execute fence RPCs');
select is((select count(*)::integer from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'begin_identity_deletion_v2', 'lease_outbox_v2',
    'authorize_outbox_delivery_v1', 'finalize_identity_deletion_v2')
    and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'authenticated cannot execute fence RPCs');
select is((select count(*)::integer from pg_catalog.pg_trigger
  where tgname = 'outbox_active_player_guard' and not tgisinternal), 1,
  'outbox insertion has an active-player guard');
select is((select count(*)::integer from pg_catalog.pg_trigger
  where tgname = 'identity_unlink_outbox_guard' and not tgisinternal), 1,
  'identity unlink has a defensive outbox guard');

create temporary table fence_results(label text primary key, response jsonb);
insert into fence_results values ('start', public.start_run_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13',
  '{"maxHp":40,"physical":5,"magical":5,"agility":5,"vitality":5,"defense":5,
    "vampRateBps":0,"postHeal":0}'::jsonb, repeat('a', 64),
  '{"items":[],"rings":[]}'::jsonb, repeat('b', 64)));
select is((select response->>'status' from fence_results where label = 'start'),
  'applied', 'fixture run starts');
insert into game.outbox_messages(logical_key, intent_type, payload)
select 'fence:queued', 'render_run_state',
  jsonb_build_object('runId', id, 'stateVersion', state_version)
from game.runs where player_id = '10000000-0000-4000-8000-000000000001';
insert into fence_results values ('begin', public.begin_identity_deletion_v2(
  '10000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001', '2099-07-13T12:00:00Z'));
select is((select response->>'status' from fence_results where label = 'begin'),
  'applied', 'fenced begin applies');
select is((select deletion_state::text from game.players
  where id = '10000000-0000-4000-8000-000000000001'),
  'deletion_pending', 'fenced begin blocks the player');
select is((select status::text from game.outbox_messages where logical_key = 'fence:queued'),
  'sent', 'fenced begin supersedes queued delivery');
select is((select last_error_kind from game.outbox_messages where logical_key = 'fence:queued'),
  'superseded', 'queued cancellation is explicit');
select throws_ok($$insert into game.outbox_messages(logical_key, intent_type, payload)
  select 'fence:forbidden-after-begin', 'render_run_state',
    jsonb_build_object('runId', id, 'stateVersion', state_version)
  from game.runs where player_id = '10000000-0000-4000-8000-000000000001'$$,
  '55000', 'inactive_player_outbox',
  'locked gameplay paths cannot enqueue after deletion begins');
select is(jsonb_array_length(public.lease_outbox_v2(
  '82000000-0000-4000-8000-000000000001', 10, 30, '2099-07-13T12:00:00Z')->'messages'),
  0, 'pending-deletion work is never leased');
select is((public.finalize_identity_deletion_v2(
  '10000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001', '2099-07-13T12:00:01Z')->>'status'),
  'applied', 'finalize succeeds after queued delivery is quiesced');
select is((select count(*)::integer from game.identity_links
  where player_id = '10000000-0000-4000-8000-000000000001'),
  0, 'fenced finalize unlinks the identity');
select is((select count(*)::integer from game.outbox_messages o join game.runs r
  on r.id = (o.payload->>'runId')::uuid
  where r.player_id = '10000000-0000-4000-8000-000000000001'
    and o.status in ('pending', 'leased')), 0,
  'successful finalize leaves no actionable outbox');

insert into game.players(id) values ('80000000-0000-4000-8000-000000000002');
insert into game.identity_links(player_id, platform, external_id)
values ('80000000-0000-4000-8000-000000000002', 'telegram', 980000000000000002);
insert into fence_results values ('second-start', public.start_run_v1(
  '80000000-0000-4000-8000-000000000002', date '2026-07-13',
  '{"maxHp":40,"physical":5,"magical":5,"agility":5,"vitality":5,"defense":5,
    "vampRateBps":0,"postHeal":0}'::jsonb, repeat('c', 64),
  '{"items":[],"rings":[]}'::jsonb, repeat('d', 64)));
insert into game.outbox_messages(logical_key, intent_type, payload)
select 'fence:leased', 'render_run_state',
  jsonb_build_object('runId', id, 'stateVersion', state_version)
from game.runs where player_id = '80000000-0000-4000-8000-000000000002';
insert into fence_results values ('lease', public.lease_outbox_v2(
  '82000000-0000-4000-8000-000000000002', 1, 30, '2099-07-13T12:00:00Z'));
select is(jsonb_array_length((select response->'messages' from fence_results where label = 'lease')),
  1, 'active linked player can be leased');
select ok(not ((select response->'messages'->0 from fence_results where label = 'lease')
  ? 'telegramExternalId'), 'lease does not expose Telegram identity');
insert into fence_results values ('second-begin', public.begin_identity_deletion_v2(
  '80000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002', '2099-07-13T12:00:01Z'));
select throws_ok($$select public.finalize_identity_deletion_v1(
    '80000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002')$$,
  '55000', 'outbox_delivery_in_flight',
  'locked V1 finalization cannot bypass a live delivery lease');
select is((public.finalize_identity_deletion_v2(
  '80000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002', '2099-07-13T12:00:02Z')->>'reason'),
  'outbox_delivery_in_flight', 'a live lease blocks identity unlink');
select is((public.authorize_outbox_delivery_v1(
  ((select response->'messages'->0->>'id' from fence_results where label = 'lease'))::uuid,
  ((select response->'messages'->0->>'leaseId' from fence_results where label = 'lease'))::uuid,
  '2099-07-13T12:00:02Z')->>'status'),
  'superseded', 'pending identity cannot authorize Telegram delivery');
select is((public.finalize_identity_deletion_v2(
  '80000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000002', '2099-07-13T12:00:03Z')->>'status'),
  'applied', 'same context finalizes after the lease is superseded');
select is((select count(*)::integer from game.identity_links
  where player_id = '80000000-0000-4000-8000-000000000002'),
  0, 'leased scenario ends unlinked');

select * from finish();
rollback;
