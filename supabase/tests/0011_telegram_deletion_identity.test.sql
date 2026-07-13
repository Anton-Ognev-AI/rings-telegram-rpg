begin;
select plan(17);

select has_function('public', 'telegram_deletion_identity_v1', array['bigint'],
  'deletion identity lookup RPC exists');
select ok((select p.prosecdef from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'telegram_deletion_identity_v1'),
  'deletion identity lookup is security definer');
select ok((select p.proconfig @> array['search_path=pg_catalog, game, pg_temp']
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'telegram_deletion_identity_v1'),
  'deletion identity lookup pins safe search_path');
select is((select r.rolname from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname = 'telegram_deletion_identity_v1'),
  'postgres', 'postgres owns deletion identity lookup');
select ok(has_function_privilege(
  'service_role', 'public.telegram_deletion_identity_v1(bigint)', 'execute'),
  'service role can look up deletion context');
select ok(not has_function_privilege(
  'anon', 'public.telegram_deletion_identity_v1(bigint)', 'execute'),
  'anon cannot look up deletion context');
select ok(not has_function_privilege(
  'authenticated', 'public.telegram_deletion_identity_v1(bigint)', 'execute'),
  'authenticated cannot look up deletion context');

insert into game.players(id) values ('71000000-0000-4000-8000-000000000001');
insert into game.identity_links(player_id, platform, external_id)
values ('71000000-0000-4000-8000-000000000001', 'telegram', 970000000000000001);
create temporary table deletion_lookup_results(label text primary key, response jsonb);
insert into deletion_lookup_results values ('active',
  public.telegram_deletion_identity_v1(970000000000000001));
select is((select response->>'status' from deletion_lookup_results where label = 'active'),
  'ok', 'active identity is found');
select is((select response->>'playerId' from deletion_lookup_results where label = 'active'),
  '71000000-0000-4000-8000-000000000001', 'lookup returns only surrogate player ID');
select is((select response->>'deletionState' from deletion_lookup_results where label = 'active'),
  'active', 'active state is explicit');
select is((select array_agg(key order by key) from deletion_lookup_results,
    lateral jsonb_object_keys(response) as key where label = 'active'),
  array['deletionId', 'deletionRequestedAt', 'deletionState', 'playerId', 'status']::text[],
  'lookup exposes exactly the deletion contract fields');
select ok((select response->'deletionId' = 'null'::jsonb
  and response->'deletionRequestedAt' = 'null'::jsonb
  from deletion_lookup_results where label = 'active'),
  'active lookup has no invented deletion context');

update game.players set
  deletion_state = 'deletion_pending',
  deletion_id = '72000000-0000-4000-8000-000000000001',
  deletion_requested_at = '2026-07-13T14:00:00Z'
where id = '71000000-0000-4000-8000-000000000001';
insert into deletion_lookup_results values ('pending',
  public.telegram_deletion_identity_v1(970000000000000001));
select is((select response->>'deletionId' from deletion_lookup_results where label = 'pending'),
  '72000000-0000-4000-8000-000000000001', 'pending lookup reuses authoritative deletion ID');
select is((select response->>'deletionRequestedAt' from deletion_lookup_results
  where label = 'pending'), '2026-07-13T14:00:00+00:00',
  'pending lookup preserves original audit timestamp');
insert into deletion_lookup_results values ('unknown',
  public.telegram_deletion_identity_v1(970000000000000099));
select is((select response->>'status' from deletion_lookup_results where label = 'unknown'),
  'none', 'unknown identity returns none');
select is(public.telegram_deletion_identity_v1(-1)->>'reason',
  'invalid_external_id', 'invalid external ID is rejected');

set local role anon;
select throws_ok($$select public.telegram_deletion_identity_v1(970000000000000001)$$,
  '42501', null, 'anon execution is denied under impersonation');
reset role;

select * from finish();
rollback;
