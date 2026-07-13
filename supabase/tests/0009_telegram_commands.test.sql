begin;
select plan(31);

select has_table('game', 'telegram_run_cards', 'run card delivery table exists');
select has_column('game', 'outbox_messages', 'lease_id', 'outbox has opaque lease ID');
select has_column('game', 'outbox_messages', 'leased_by', 'outbox records leasing worker');
select has_column('game', 'outbox_messages', 'last_error_kind', 'outbox records classified error');
select has_function('public', 'telegram_identity_v1', 'Telegram identity RPC exists');
select has_function('public', 'start_run_v2', 'atomic Telegram start RPC exists');
select has_function('public', 'run_view_v1', 'canonical run view RPC exists');
select has_function('public', 'lease_outbox_v1', 'outbox lease RPC exists');
select has_function('public', 'complete_outbox_v1', 'outbox completion RPC exists');
select has_function('public', 'publish_fallback_day_v1', 'fallback publish RPC exists');
select has_function('public', 'advance_day_v1', 'day lifecycle RPC exists');
select has_function('public', 'abandon_run_v1', 'run abandon RPC exists');

select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v1', 'start_run_v2', 'run_view_v1', 'lease_outbox_v1',
      'complete_outbox_v1', 'publish_fallback_day_v1', 'advance_day_v1', 'abandon_run_v1'
    ) and p.prosecdef), 8, 'all Phase 3 command/query RPCs are security definer');
select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v1', 'start_run_v2', 'run_view_v1', 'lease_outbox_v1',
      'complete_outbox_v1', 'publish_fallback_day_v1', 'advance_day_v1', 'abandon_run_v1'
    ) and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']),
  8, 'all Phase 3 RPCs pin the safe search path');

select ok((select relrowsecurity from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'game' and c.relname = 'telegram_run_cards'),
  'run cards have RLS enabled');
select ok(not has_table_privilege('service_role', 'game.telegram_run_cards', 'select'),
  'service role has no direct run-card read');
select ok(not has_table_privilege('service_role', 'game.telegram_run_cards', 'insert'),
  'service role has no direct run-card insert');
select ok(not has_table_privilege('anon', 'game.telegram_run_cards', 'select'),
  'anon has no direct run-card read');
select ok(not has_table_privilege('authenticated', 'game.telegram_run_cards', 'select'),
  'authenticated has no direct run-card read');

select ok(has_function_privilege(
  'service_role', 'public.telegram_identity_v1(bigint,boolean)', 'execute'),
  'service role can execute identity RPC');
select ok(not has_function_privilege(
  'anon', 'public.telegram_identity_v1(bigint,boolean)', 'execute'),
  'anon cannot execute identity RPC');
select ok(not has_function_privilege(
  'authenticated', 'public.telegram_identity_v1(bigint,boolean)', 'execute'),
  'authenticated cannot execute identity RPC');
select ok(has_function_privilege(
  'service_role', 'public.lease_outbox_v1(uuid,integer,integer,timestamp with time zone)',
  'execute'), 'service role can lease outbox');
select ok(not has_function_privilege(
  'anon', 'public.lease_outbox_v1(uuid,integer,integer,timestamp with time zone)',
  'execute'), 'anon cannot lease outbox');

select lives_ok($$
  insert into game.outbox_messages(logical_key, intent_type, payload)
  values ('p3-safe-probe', 'render_run_state',
    '{"runId":"00000000-0000-4000-8000-000000000001","stateVersion":0}'::jsonb)
$$, 'outbox accepts internal-only intent payload');
select throws_ok($$
  insert into game.outbox_messages(logical_key, intent_type, payload)
  values ('p3-pii-probe', 'render_run_state', '{"telegram_id":900000000000000001}'::jsonb)
$$, '23514', null, 'outbox rejects Telegram identifiers');
select throws_ok($$
  insert into game.outbox_messages(logical_key, intent_type, payload)
  values ('p3-text-probe', 'render_run_state', '{"text":"secret message"}'::jsonb)
$$, '23514', null, 'outbox rejects rendered message text');

set local role anon;
select throws_ok($$select public.telegram_identity_v1(900000000000000001, true)$$,
  '42501', null, 'anon identity bootstrap is denied under impersonation');
reset role;
set local role service_role;
select lives_ok($$select public.telegram_identity_v1(900000000000000001, false)$$,
  'service role identity lookup works without private schema usage');
reset role;

select is((select count(*)::integer
  from information_schema.columns
  where table_schema = 'game' and table_name = 'outbox_messages'
    and column_name in ('telegram_id', 'external_id', 'message_text', 'callback_token')),
  0, 'durable outbox has no Telegram PII or raw callback columns');
select is((select count(*)::integer
  from information_schema.columns
  where table_schema = 'game' and table_name = 'telegram_run_cards'
    and column_name in ('telegram_id', 'external_id', 'chat_id', 'message_text')),
  0, 'run-card table stores no chat identity or message text');

select * from finish();
rollback;
