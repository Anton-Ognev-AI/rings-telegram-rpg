insert into game.config_versions (
  id,
  version,
  resolver_version,
  payload,
  payload_sha256,
  daily_xp_cap,
  status
) values (
  '00000000-0000-4000-8000-000000000001',
  'config-v1',
  'v1',
  '{"bossCounterIncomingPercent":50,"bossDamage":[24,34],"bossFailureIncomingPercent":150,"bossMaxHp":90,"bossNeutralDamagePercent":25,"bossOwnerDamage":[32,58],"dailyXpCap":150,"defenseScale":100,"failureDamage":[5,6,8,10,13,14,16,18,20,0],"neutralDamage":[2,2,3,4,6,6,7,8,8,0],"neutralXpPercent":20,"stageThresholds":[5,7,10,14,19,25,32,40,49,60],"stageXp":[10,15,18,20,27,10,12,13,10,15],"successDamage":[0,0,1,2,3,3,4,5,5,0],"tacticalBandDelta":{"against_telegraph":1,"counter":-1,"standard":0},"tierDelta":{"easy":-2,"hard":5,"standard":0},"vampRunCapBps":2500,"vampStageCapBps":800}'::jsonb,
  'e62656603ca981577373bcbbebcb78d29ad161431e1aa9adcfbb8c2392ff79ef',
  150,
  'active'
) on conflict (version) do nothing;

insert into game.feature_flags (key, enabled, config_version_id) values
  ('generation', false, '00000000-0000-4000-8000-000000000001'),
  ('broadcast', false, '00000000-0000-4000-8000-000000000001'),
  ('drops', false, '00000000-0000-4000-8000-000000000001'),
  ('breakthroughs', false, '00000000-0000-4000-8000-000000000001'),
  ('partnerships', false, '00000000-0000-4000-8000-000000000001'),
  ('reminders', false, '00000000-0000-4000-8000-000000000001')
on conflict (key) do nothing;

insert into game.players (id, personal_label) values
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Academy Student')
on conflict (id) do nothing;

insert into game.identity_links (id, player_id, platform, external_id, username) values
  (
    '11000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'telegram',
    900000000000000001,
    'synthetic_academy_student'
  )
on conflict (platform, external_id) do nothing;

insert into game.player_stats (
  player_id, physical, magical, agility, vitality, defense, max_hp
) values (
  '10000000-0000-4000-8000-000000000001', 5, 5, 5, 5, 5, 40
)
on conflict (player_id) do nothing;

insert into game.xp_accounts (player_id) values
  ('10000000-0000-4000-8000-000000000001')
on conflict (player_id) do nothing;
