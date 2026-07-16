begin;
select plan(13);

select has_table('game', 'delivery_unknown_reconciliations',
  'delivery-unknown reconciliation audit exists');
select has_function(
  'public', 'reconcile_delivery_unknown_v1',
  array['uuid', 'uuid', 'text', 'bigint', 'timestamp with time zone'],
  'incident-bound reconciliation RPC exists'
);
select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'reconcile_delivery_unknown_v1'
    and p.prosecdef), 1, 'reconciliation RPC is security definer');
select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'reconcile_delivery_unknown_v1'
    and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']),
  1, 'reconciliation RPC pins the safe search path');
select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.proname = 'reconcile_delivery_unknown_v1'
    and r.rolname = 'postgres'), 1, 'postgres owns reconciliation RPC');
select ok(has_function_privilege(
  'service_role',
  'public.reconcile_delivery_unknown_v1(uuid,uuid,text,bigint,timestamp with time zone)',
  'execute'
), 'service role can reconcile an incident');
select ok(not has_function_privilege(
  'anon',
  'public.reconcile_delivery_unknown_v1(uuid,uuid,text,bigint,timestamp with time zone)',
  'execute'
) and not has_function_privilege(
  'authenticated',
  'public.reconcile_delivery_unknown_v1(uuid,uuid,text,bigint,timestamp with time zone)',
  'execute'
), 'client roles cannot reconcile an incident');
select is((select count(*)::integer
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'game'
    and c.relname = 'delivery_unknown_reconciliations'
    and c.relrowsecurity), 1, 'reconciliation audit enables RLS');
select is((select count(*)::integer
  from information_schema.table_privileges
  where table_schema = 'game'
    and table_name = 'delivery_unknown_reconciliations'
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  0, 'API roles have no direct reconciliation audit access');
select columns_are(
  'game', 'delivery_unknown_reconciliations',
  array[
    'outbox_id', 'delivery_incident_id', 'decision', 'telegram_message_id',
    'outcome', 'result', 'reconciled_at'
  ], 'reconciliation evidence has only its pinned contract columns'
);
select col_is_pk(
  'game', 'delivery_unknown_reconciliations',
  array['outbox_id', 'delivery_incident_id']::name[],
  'each outbox delivery incident has one immutable decision'
);
select has_trigger(
  'game', 'delivery_unknown_reconciliations',
  'delivery_unknown_reconciliations_append_only',
  'reconciliation evidence is append-only'
);
select ok(not has_function_privilege(
  'service_role', 'game.guard_delivery_unknown_reconciliation_v1()', 'execute'
), 'service role cannot execute the private append-only guard');

select * from finish();
rollback;
