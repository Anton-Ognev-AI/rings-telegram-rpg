begin;
select plan(12);

select has_schema('game', 'private game schema exists');
select ok(not has_schema_privilege('public', 'game', 'usage'), 'public cannot use game schema');
select ok(not has_schema_privilege('anon', 'game', 'usage'), 'anon cannot use game schema');
select ok(not has_schema_privilege('authenticated', 'game', 'usage'), 'authenticated cannot use game schema');
select ok(not has_schema_privilege('service_role', 'game', 'usage'), 'service_role cannot use game schema');

select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'identity_deletion_state'),
  'active,deletion_pending', 'identity deletion labels are pinned');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'content_validation_status'),
  'validated,fallback_validated,quarantined', 'content validation labels are pinned');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'dungeon_day_status'),
  'scheduled,ready,fallback_ready,open,grace,closed', 'dungeon day labels are pinned');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'run_status'),
  'active,finished_victory,finished_contained,defeated,expired,abandoned,cancelled_safety',
  'run status labels are pinned');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'run_phase'),
  'awaiting_choice,boss_exchange_1,boss_exchange_2,blocked_by_offer', 'run phase labels are pinned');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'action_status'),
  'applied,cached,stale,rejected', 'action status labels are pinned');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'game' and t.typname = 'outbox_status'),
  'pending,leased,sent,delivery_unknown,dead', 'outbox status labels are pinned');

select * from finish();
rollback;
