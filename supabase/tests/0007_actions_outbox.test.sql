begin;
select plan(25);

select has_table('game', 'action_tokens', 'prepared action tokens exist');
select has_table('game', 'processed_actions', 'processed action cache exists');
select has_table('game', 'outbox_messages', 'transactional outbox exists');
select has_table('game', 'analytics_events', 'typed analytics events exist');
select has_function('game', 'assert_prepared_resolution_v1', 'prepared resolution validator exists');
select has_function('game', 'is_safe_analytics_json', 'PII safety validator exists');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'action_tokens'),
  'action token RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'processed_actions'),
  'processed action RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'outbox_messages'),
  'outbox RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'analytics_events'),
  'analytics RLS is enabled');
select ok(not has_table_privilege('service_role', 'game.action_tokens', 'insert'),
  'service role cannot directly prepare actions');
select ok(not has_table_privilege('service_role', 'game.outbox_messages', 'insert'),
  'service role cannot bypass transactional outbox');
select ok(not exists(select 1 from information_schema.columns
  where table_schema = 'game' and table_name = 'action_tokens' and column_name = 'token'),
  'raw callback token is never stored');

insert into game.runs (
  id, player_id, cycle_id, content_version_id, config_version_id,
  status, phase, state_version, stage, hp, max_hp, xp_earned
) values (
  '40000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000001', date '2026-07-13',
  '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  'active', 'awaiting_choice', 0, 1, 40, 40, 0
);

select lives_ok($$select game.assert_prepared_resolution_v1(
  '{"resolverVersion":"v1","stage":1,"exchange":null,"choiceId":"s1-neutral",
    "outcome":"neutral","hp":{"before":40,"damage":2,"vampHeal":0,"postHeal":0,"after":38},
    "bossHp":null,"xp":{"before":0,"delta":2,"after":2},"terminal":null,
    "nextStage":2,"nextExchange":null}'::jsonb)$$, 'valid prepared resolution is accepted');
select throws_ok($$select game.assert_prepared_resolution_v1('{"stage":1}'::jsonb)$$,
  '23514', null, 'incomplete resolution is rejected');

insert into game.action_tokens (
  token_sha256, player_id, run_id, expected_state_version, stage, exchange, choice_id,
  context_sha256, prepared_resolution, resolution_sha256, expires_at
) values (
  repeat('a', 64), '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000007', 0, 1, 0, 's1-neutral', repeat('b', 64),
  '{"resolverVersion":"v1","stage":1,"exchange":null,"choiceId":"s1-neutral",
    "outcome":"neutral","hp":{"before":40,"damage":2,"vampHeal":0,"postHeal":0,"after":38},
    "bossHp":null,"xp":{"before":0,"delta":2,"after":2},"terminal":null,
    "nextStage":2,"nextExchange":null}'::jsonb,
  repeat('c', 64), clock_timestamp() + interval '1 hour'
);
select is((select choice_id from game.action_tokens where token_sha256 = repeat('a', 64)),
  's1-neutral', 'prepared action is stored by hash');
select throws_ok($$insert into game.action_tokens (
    token_sha256, player_id, run_id, expected_state_version, stage, exchange, choice_id,
    context_sha256, prepared_resolution, resolution_sha256, expires_at
  ) select 'raw-token', player_id, run_id, expected_state_version, stage, exchange, choice_id,
    context_sha256, prepared_resolution, resolution_sha256, expires_at from game.action_tokens limit 1$$,
  '23514', null, 'non-hash token material is rejected');
select throws_ok($$update game.action_tokens set choice_id = 'forged'$$,
  '55000', null, 'prepared action binding is immutable');

insert into game.processed_actions (
  token_sha256, telegram_update_id, status, result, result_sha256
) values (repeat('a', 64), 700000000000000001, 'applied', '{"status":"applied"}', repeat('d', 64));
insert into game.action_tokens (
  token_sha256, player_id, run_id, expected_state_version, stage, exchange, choice_id,
  context_sha256, prepared_resolution, resolution_sha256, expires_at
) select repeat('f', 64), player_id, run_id, expected_state_version, stage, exchange, choice_id,
  context_sha256, prepared_resolution, repeat('e', 64), expires_at
from game.action_tokens where token_sha256 = repeat('a', 64);
select throws_ok($$insert into game.processed_actions (
    token_sha256, telegram_update_id, status, result, result_sha256
  ) values (repeat('a', 64), 700000000000000002, 'cached', '{}', repeat('e', 64))$$,
  '23505', null, 'one processed result exists per token');
select throws_ok($$insert into game.processed_actions (
    token_sha256, telegram_update_id, status, result, result_sha256
  ) values (repeat('f', 64), 700000000000000001, 'applied', '{}', repeat('e', 64))$$,
  '23505', null, 'Telegram update ID cannot bind another action');
select throws_ok($$update game.processed_actions set result = '{}'::jsonb$$,
  '55000', null, 'processed result is immutable');

insert into game.outbox_messages(logical_key, status, intent_type, payload)
values ('run:7:state:1', 'pending', 'render_run_state', '{"runId":"synthetic"}');
select throws_ok($$insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values ('run:7:state:1', 'pending', 'render_run_state', '{}')$$,
  '23505', null, 'outbox logical key is unique');
select throws_ok($$insert into game.outbox_messages(logical_key, status, intent_type, payload, attempts)
  values ('negative-attempt', 'pending', 'render_run_state', '{}', -1)$$,
  '23514', null, 'outbox attempts cannot be negative');
select throws_ok($$insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values ('unsafe', 'pending', 'render_run_state', '{"nested":{"telegram_id":123}}')$$,
  '23514', null, 'outbox payload rejects nested identity data');
select throws_ok($$insert into game.analytics_events(event_name, properties)
  values ('unsafe', '{"context":{"username":"secret"}}')$$,
  '23514', null, 'analytics rejects nested identity data');

select * from finish();
rollback;
