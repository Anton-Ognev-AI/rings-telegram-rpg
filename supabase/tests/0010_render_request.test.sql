begin;
select plan(17);

select has_function('public', 'request_run_render_v1',
  array['uuid', 'uuid', 'text'], 'render repair RPC exists');
select ok((select p.prosecdef from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'request_run_render_v1'),
  'render repair RPC is security definer');
select ok((select p.proconfig @> array['search_path=pg_catalog, game, pg_temp']
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'request_run_render_v1'),
  'render repair RPC pins safe search_path');
select ok(has_function_privilege(
  'service_role', 'public.request_run_render_v1(uuid,uuid,text)', 'execute'),
  'service role can request a render repair');
select ok(not has_function_privilege(
  'anon', 'public.request_run_render_v1(uuid,uuid,text)', 'execute'),
  'anon cannot request a render repair');
select ok(not has_function_privilege(
  'authenticated', 'public.request_run_render_v1(uuid,uuid,text)', 'execute'),
  'authenticated cannot request a render repair');

create temporary table render_request_results(label text primary key, response jsonb);
insert into render_request_results values ('start', public.start_run_v1(
  '10000000-0000-4000-8000-000000000001', date '2026-07-13',
  '{"maxHp":40,"physical":5,"magical":5,"agility":5,"vitality":5,"defense":5,
    "vampRateBps":0,"postHeal":0}'::jsonb, repeat('a', 64),
  '{"items":[],"rings":[]}'::jsonb, repeat('b', 64)));
select is((select response->>'status' from render_request_results where label = 'start'),
  'applied', 'fixture run starts');

insert into game.telegram_run_cards(run_id, player_id, message_id, last_state_version)
select id, player_id, 700001, state_version from game.runs limit 1;
insert into render_request_results values ('first', public.request_run_render_v1(
  '10000000-0000-4000-8000-000000000001', (select id from game.runs limit 1),
  '700000000000000001'));
select is((select response->>'status' from render_request_results where label = 'first'),
  'applied', 'first same-state repair request applies');
select is((select intent_type from game.outbox_messages limit 1),
  'repair_run_state', 'repair uses its own edit-only intent');
select is((select payload from game.outbox_messages limit 1),
  jsonb_build_object('runId', (select id from game.runs limit 1), 'stateVersion', 0),
  'repair payload contains only the run and state version');
select ok((select logical_key not like '%700000000000000001%'
  from game.outbox_messages limit 1), 'raw request key is not persisted');

insert into render_request_results values ('same', public.request_run_render_v1(
  '10000000-0000-4000-8000-000000000001', (select id from game.runs limit 1),
  '700000000000000001'));
insert into render_request_results values ('coalesced', public.request_run_render_v1(
  '10000000-0000-4000-8000-000000000001', (select id from game.runs limit 1),
  '700000000000000002'));
select is((select response->>'status' from render_request_results where label = 'same'),
  'cached', 'same request is idempotent');
select is((select response->>'status' from render_request_results where label = 'coalesced'),
  'cached', 'a concurrent same-state repair coalesces');
select is((select count(*)::integer from game.outbox_messages), 1,
  'coalesced requests create one actionable repair');

insert into game.players(id) values ('10000000-0000-4000-8000-000000000002');
insert into render_request_results values ('foreign', public.request_run_render_v1(
  '10000000-0000-4000-8000-000000000002', (select id from game.runs limit 1),
  '700000000000000003'));
select is((select response->>'reason' from render_request_results where label = 'foreign'),
  'actor_mismatch', 'foreign run repair is rejected');
insert into render_request_results values ('invalid', public.request_run_render_v1(
  '10000000-0000-4000-8000-000000000001', (select id from game.runs limit 1),
  'not-an-update-id'));
select is((select response->>'reason' from render_request_results where label = 'invalid'),
  'invalid_request_key', 'unbounded or non-opaque request key is rejected');

update game.outbox_messages set status = 'sent';
delete from game.telegram_run_cards;
insert into render_request_results values ('no-card', public.request_run_render_v1(
  '10000000-0000-4000-8000-000000000001', (select id from game.runs limit 1),
  '700000000000000004'));
select is((select response->>'reason' from render_request_results where label = 'no-card'),
  'card_unavailable', 'repair never blind-sends when canonical card is unknown');

select * from finish();
rollback;
