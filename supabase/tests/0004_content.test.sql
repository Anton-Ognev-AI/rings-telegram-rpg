begin;
select plan(18);

select has_table('game', 'content_versions', 'content_versions exists');
select has_table('game', 'dungeon_days', 'dungeon_days exists');
select has_table('game', 'fallback_content', 'fallback_content exists');
select is((select count(*)::integer from game.content_versions), 1,
  'reviewed fallback content is seeded');
select is((select payload_sha256 from game.content_versions),
  '9000f0cebc29e6483b80de0bf8cf09c6f926821d317c17890654bc343fbb1c81',
  'fallback content canonical hash is pinned');
select is((select validation_status::text from game.content_versions), 'fallback_validated',
  'fallback content is explicitly classified');
select is((select count(*)::integer from game.fallback_content where slot = 'daily-v1'), 1,
  'daily fallback slot is pinned');
select is((select status::text from game.dungeon_days where cycle_id = date '2026-07-13'),
  'fallback_ready', 'synthetic day is fallback-ready');
select is((select opens_at from game.dungeon_days where cycle_id = date '2026-07-13'),
  timestamptz '2026-07-13 06:00:00+00', 'summer cycle opens at Kyiv 09:00');
select is((select grace_ends_at - closes_at from game.dungeon_days
  where cycle_id = date '2026-07-13'), interval '2 hours', 'grace lasts two hours');
select is(
  extract(epoch from (((date '2026-03-29' + time '09:00') at time zone 'Europe/Kyiv') -
    ((date '2026-03-28' + time '09:00') at time zone 'Europe/Kyiv')))::bigint,
  82800::bigint, 'spring Kyiv cycle is 23 UTC hours');
select is(
  extract(epoch from (((date '2026-10-25' + time '09:00') at time zone 'Europe/Kyiv') -
    ((date '2026-10-24' + time '09:00') at time zone 'Europe/Kyiv')))::bigint,
  90000::bigint, 'autumn Kyiv cycle is 25 UTC hours');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'content_versions'),
  'content RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'dungeon_days'),
  'dungeon day RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'fallback_content'),
  'fallback RLS is enabled');
select ok(not has_table_privilege('anon', 'game.content_versions', 'select'),
  'anon cannot read content tables');
select ok(not has_table_privilege('service_role', 'game.dungeon_days', 'insert'),
  'service role cannot directly schedule days');
select throws_ok(
  $$update game.content_versions set payload = '{"forged":true}'::jsonb$$,
  '55000', null, 'validated content is immutable');

select * from finish();
rollback;
