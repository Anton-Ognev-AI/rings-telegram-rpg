begin;
select plan(14);

select has_table('game', 'players', 'players exists');
select has_table('game', 'identity_links', 'identity_links exists');
select has_table('game', 'player_stats', 'player_stats exists');
select is((select count(*)::integer from game.players), 1, 'one synthetic player is seeded');
select is((select external_id from game.identity_links where platform = 'telegram'),
  900000000000000001::bigint, '64-bit synthetic Telegram ID is preserved');
select is((select physical + magical + agility + vitality from game.player_stats), 20,
  'four core stats are seeded');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'players'),
  'players RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'identity_links'),
  'identity links RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
  on n.oid = c.relnamespace where n.nspname = 'game' and c.relname = 'player_stats'),
  'player stats RLS is enabled');
select ok(not has_table_privilege('anon', 'game.identity_links', 'select'),
  'anon cannot read identities');
select ok(not has_table_privilege('service_role', 'game.players', 'insert'),
  'service role cannot directly insert players');
insert into game.players(id) values ('10000000-0000-4000-8000-000000000097');
select throws_ok(
  $$insert into game.player_stats(player_id, physical, magical, agility, vitality, defense, max_hp)
    values ('10000000-0000-4000-8000-000000000097', -1, 0, 0, 0, 0, 1)$$,
  '23514', null, 'negative stats are rejected');
select throws_ok(
  $$insert into game.players(id, deletion_state)
    values ('10000000-0000-4000-8000-000000000099', 'deletion_pending')$$,
  '23514', null, 'pending deletion requires matching metadata');

insert into game.players(id) values ('10000000-0000-4000-8000-000000000098');
insert into game.identity_links(id, player_id, platform, external_id)
values ('11000000-0000-4000-8000-000000000098', '10000000-0000-4000-8000-000000000098',
  'telegram', 900000000000000098);
insert into game.player_stats(player_id, physical, magical, agility, vitality, defense, max_hp)
values ('10000000-0000-4000-8000-000000000098', 1, 1, 1, 1, 1, 10);
delete from game.players where id = '10000000-0000-4000-8000-000000000098';
select is((select count(*)::integer from game.identity_links
  where player_id = '10000000-0000-4000-8000-000000000098'), 0,
  'identity and stats cascade from surrogate player');

select * from finish();
rollback;
