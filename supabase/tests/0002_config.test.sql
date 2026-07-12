begin;
select plan(15);

select has_table('game', 'config_versions', 'config_versions exists');
select has_table('game', 'feature_flags', 'feature_flags exists');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'config_versions'),
  'config RLS is enabled');
select is((select count(*)::integer from game.config_versions where status = 'active'), 1,
  'exactly one active config is seeded');
select is((select daily_xp_cap from game.config_versions where status = 'active'), 150,
  'daily XP cap is pinned');
select is((select resolver_version from game.config_versions where status = 'active'), 'v1',
  'resolver version is pinned');
select is((select payload_sha256 from game.config_versions where status = 'active'),
  'e62656603ca981577373bcbbebcb78d29ad161431e1aa9adcfbb8c2392ff79ef',
  'canonical config hash is pinned');
select is((select count(*)::integer from game.feature_flags), 6, 'six kill switches are seeded');
select ok(not exists(select 1 from game.feature_flags where enabled), 'all kill switches default off');
select ok(not has_table_privilege('anon', 'game.config_versions', 'select'), 'anon cannot read config');
select ok(not has_table_privilege('authenticated', 'game.config_versions', 'select'),
  'authenticated cannot read config');
select throws_ok(
  $$update game.config_versions set payload = '{"dailyXpCap":999}'::jsonb where status = 'active'$$,
  '55000', null, 'active config payload is immutable');

set local role anon;
select throws_ok($$select * from game.config_versions$$, '42501', null,
  'anon is denied under role impersonation');
reset role;
set local role authenticated;
select throws_ok($$select * from game.config_versions$$, '42501', null,
  'authenticated is denied under role impersonation');
reset role;
set local role service_role;
select throws_ok($$select * from game.config_versions$$, '42501', null,
  'service role is denied direct reads under impersonation');
reset role;

select * from finish();
rollback;
