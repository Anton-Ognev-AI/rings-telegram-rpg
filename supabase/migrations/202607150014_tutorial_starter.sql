create table game.progression_config_versions (
  id uuid primary key,
  version text not null unique check (version <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('active', 'retired')),
  created_at timestamptz not null default clock_timestamp()
);

create unique index progression_config_one_active_idx
  on game.progression_config_versions ((status)) where status = 'active';

create trigger progression_config_versions_immutable
before update or delete on game.progression_config_versions
for each row execute function game.reject_immutable_change();

create table game.player_onboarding (
  player_id uuid primary key references game.players(id) on delete cascade,
  tutorial_completed smallint not null default 0 check (tutorial_completed between 0 and 2),
  profile_version bigint not null default 0 check (profile_version >= 0),
  academy_rank text not null default 'student' check (academy_rank in ('student', 'novice')),
  first_purchased_stat text check (
    first_purchased_stat is null
    or first_purchased_stat in ('physical', 'magical', 'agility', 'vitality')
  ),
  first_stat_purchase_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint onboarding_rank_check check (
    (tutorial_completed < 2 and academy_rank = 'student')
    or (tutorial_completed = 2 and academy_rank = 'novice')
  )
);

create trigger player_onboarding_touch_updated_at
before update on game.player_onboarding
for each row execute function game.touch_updated_at();

create table game.player_stat_progression (
  player_id uuid primary key references game.players(id) on delete cascade,
  physical_purchased smallint not null default 0 check (physical_purchased between 0 and 30),
  magical_purchased smallint not null default 0 check (magical_purchased between 0 and 30),
  agility_purchased smallint not null default 0 check (agility_purchased between 0 and 30),
  vitality_purchased smallint not null default 0 check (vitality_purchased between 0 and 30),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger player_stat_progression_touch_updated_at
before update on game.player_stat_progression
for each row execute function game.touch_updated_at();

create table game.tutorial_run_assignments (
  run_id uuid primary key references game.runs(id) on delete cascade,
  player_id uuid not null references game.players(id) on delete cascade,
  tutorial_ordinal smallint not null check (tutorial_ordinal between 1 and 2),
  guidance text not null check (guidance in ('full', 'light')),
  progression_config_id uuid not null
    references game.progression_config_versions(id) on delete restrict,
  teacher_snapshot jsonb not null check (jsonb_typeof(teacher_snapshot) = 'object'),
  rescue_used boolean not null default false,
  rescue_used_at timestamptz,
  credited_at timestamptz,
  credit_reason text check (
    credit_reason is null or credit_reason in ('natural_terminal', 'hp_zero', 'eligible_expiry')
  ),
  result_count_at_credit integer check (
    result_count_at_credit is null or result_count_at_credit >= 0
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (player_id, tutorial_ordinal),
  constraint tutorial_rescue_state_check check (
    (not rescue_used and rescue_used_at is null)
    or (rescue_used and rescue_used_at is not null)
  ),
  constraint tutorial_credit_state_check check (
    (credited_at is null and credit_reason is null and result_count_at_credit is null)
    or (credited_at is not null and credit_reason is not null and result_count_at_credit is not null)
  )
);

create table game.player_equipment (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references game.players(id) on delete cascade,
  slot text not null check (slot in ('main', 'armor', 'talisman')),
  item_key text not null check (
    item_key in ('training_sword', 'apprentice_focus', 'training_armor', 'student_talisman')
  ),
  rarity text not null default 'ordinary' check (rarity = 'ordinary'),
  bonuses jsonb not null check (jsonb_typeof(bonuses) = 'object'),
  acquired_at timestamptz not null default clock_timestamp(),
  unique (player_id, slot)
);

create table game.player_rings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references game.players(id) on delete cascade,
  ring_kind text not null check (ring_kind in ('weapon', 'fire', 'defense', 'healing')),
  color text not null default 'blue' check (color = 'blue'),
  rarity text not null default 'ordinary' check (rarity = 'ordinary'),
  mastery_percent integer not null default 0 check (mastery_percent between 0 and 100),
  invested_xp bigint not null default 0 check (invested_xp >= 0),
  blue_budget integer not null default 2000 check (blue_budget = 2000),
  progression_config_id uuid not null
    references game.progression_config_versions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger player_rings_touch_updated_at
before update on game.player_rings
for each row execute function game.touch_updated_at();

create table game.player_offers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references game.players(id) on delete cascade,
  source_run_id uuid not null references game.runs(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 2),
  offer_kind text not null check (offer_kind in ('tutorial_item', 'starter_ring')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'discarded')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (player_id, source_run_id, sequence),
  constraint player_offer_order_check check (
    (sequence = 1 and offer_kind = 'tutorial_item')
    or (sequence = 2 and offer_kind = 'starter_ring')
  ),
  constraint player_offer_resolution_check check (
    (status = 'pending' and resolved_at is null)
    or (status in ('accepted', 'discarded') and resolved_at is not null)
  )
);

create table game.player_action_tokens (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  id uuid not null unique default gen_random_uuid(),
  player_id uuid not null references game.players(id) on delete cascade,
  expected_profile_version bigint not null check (expected_profile_version >= 0),
  expected_message_id bigint not null check (expected_message_id > 0),
  action jsonb not null check (
    jsonb_typeof(action) = 'object'
    and action->>'kind' in (
      'buy_stat', 'defer_stat', 'accept_item', 'discard_item',
      'choose_ring', 'train_ring_mastery'
    )
  ),
  context_sha256 text not null check (context_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  constraint player_action_token_expiry_check check (expires_at > created_at)
);

create table game.processed_player_actions (
  id uuid primary key default gen_random_uuid(),
  token_sha256 text not null unique
    references game.player_action_tokens(token_sha256) on delete restrict,
  player_id uuid not null references game.players(id) on delete cascade,
  telegram_update_id bigint not null unique check (telegram_update_id > 0),
  status game.action_status not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

create trigger processed_player_actions_immutable
before update or delete on game.processed_player_actions
for each row execute function game.reject_immutable_change();

insert into game.progression_config_versions (
  id, version, payload, payload_sha256, status
) values (
  '00000000-0000-4000-8000-000000000002',
  'progression-v1',
  '{
    "blueRing":{"budget":2000,"combatBps":1500,"masteryCostXp":20},
    "item":{"armorDefense":2,"talismanMaxHp":4},
    "rescue":{"denominator":2,"maxEarlierResults":1,"numerator":1},
    "stat":{"baseCost":20,"cap":30,"linear":6,"quadratic":2},
    "teacher":{"agility":4,"defense":2,"magical":4,"maxHp":5,"physical":4},
    "tutorialGrantXp":20,
    "vitality":{"defenseEvery":3,"maxHpPerPoint":4}
  }'::jsonb,
  '45be4ebedf0ff823cae2f8bfd364794986b1a1e401a646563f6db3d9fdc0f5dd',
  'active'
);

insert into game.feature_flags(key, enabled, config_version_id)
select 'tutorial_starter_enabled', false, id
from game.config_versions where status = 'active';

create function public.telegram_identity_v2(
  p_external_id bigint,
  p_create_if_missing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  identity_result jsonb;
  target_player_id uuid;
  onboarding_row game.player_onboarding%rowtype;
begin
  identity_result := public.telegram_identity_v1(p_external_id, p_create_if_missing);
  if identity_result->>'status' <> 'ok' then return identity_result; end if;

  target_player_id := (identity_result->>'playerId')::uuid;
  insert into game.player_onboarding(player_id) values (target_player_id)
  on conflict (player_id) do nothing;
  insert into game.player_stat_progression(player_id) values (target_player_id)
  on conflict (player_id) do nothing;
  select * into strict onboarding_row from game.player_onboarding
  where player_id = target_player_id;

  return identity_result || jsonb_build_object(
    'tutorialCompleted', onboarding_row.tutorial_completed,
    'profileVersion', onboarding_row.profile_version,
    'rank', onboarding_row.academy_rank
  );
end;
$$;

create function public.player_home_v1(p_player_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  onboarding_row game.player_onboarding%rowtype;
  free_xp bigint;
  pending_offer jsonb;
  active_run_id uuid;
  terminal_run_id uuid;
begin
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;
  select * into onboarding_row from game.player_onboarding where player_id = p_player_id;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'onboarding_not_initialized');
  end if;
  select balance into strict free_xp from game.xp_accounts where player_id = p_player_id;
  select jsonb_build_object(
    'id', id,
    'kind', offer_kind,
    'sequence', sequence,
    'sourceRunId', source_run_id
  ) into pending_offer
  from game.player_offers
  where player_id = p_player_id and status = 'pending'
  order by created_at, sequence limit 1;
  select id into active_run_id from game.runs
  where player_id = p_player_id and status = 'active'
  order by started_at desc limit 1;
  select id into terminal_run_id from game.runs
  where player_id = p_player_id
    and status in ('finished_victory', 'finished_contained', 'defeated', 'expired')
  order by finished_at desc nulls last, started_at desc limit 1;

  return jsonb_build_object(
    'status', 'ok',
    'playerId', p_player_id,
    'profileVersion', onboarding_row.profile_version,
    'tutorialCompleted', onboarding_row.tutorial_completed,
    'rank', onboarding_row.academy_rank,
    'freeXp', free_xp,
    'pendingOffer', pending_offer,
    'activeRunId', active_run_id,
    'lastTerminalRunId', terminal_run_id
  );
end;
$$;

create function public.start_run_v3(p_player_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  onboarding_row game.player_onboarding%rowtype;
  stats_row game.player_stats%rowtype;
  progression_row game.progression_config_versions%rowtype;
  teacher_snapshot jsonb;
  self_snapshot jsonb;
  loadout_snapshot jsonb;
  self_hash text;
  loadout_hash text;
  start_result jsonb;
  result_run_id uuid;
  tutorial_ordinal smallint;
  tutorial_guidance text;
  group_max_hp integer;
begin
  if p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_time');
  end if;
  if not exists(select 1 from game.feature_flags
    where key = 'tutorial_starter_enabled' and enabled) then
    return jsonb_build_object('status', 'rejected', 'reason', 'tutorial_starter_disabled');
  end if;
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;

  select * into onboarding_row from game.player_onboarding
  where player_id = p_player_id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'onboarding_not_initialized');
  end if;
  select * into strict stats_row from game.player_stats where player_id = p_player_id;
  select * into progression_row from game.progression_config_versions where status = 'active';
  if not found or progression_row.version <> 'progression-v1'
    or progression_row.payload_sha256 <>
      '45be4ebedf0ff823cae2f8bfd364794986b1a1e401a646563f6db3d9fdc0f5dd'
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_progression_config');
  end if;

  self_snapshot := jsonb_build_object(
    'maxHp', stats_row.max_hp,
    'physical', stats_row.physical,
    'magical', stats_row.magical,
    'agility', stats_row.agility,
    'vitality', stats_row.vitality,
    'defense', stats_row.defense,
    'vampRateBps', 0,
    'postHeal', 0
  );
  if onboarding_row.tutorial_completed < 2 then
    tutorial_ordinal := onboarding_row.tutorial_completed + 1;
    tutorial_guidance := case tutorial_ordinal when 1 then 'full' else 'light' end;
    teacher_snapshot := progression_row.payload->'teacher';
    group_max_hp := stats_row.max_hp + (teacher_snapshot->>'maxHp')::integer;
    loadout_snapshot := jsonb_build_object(
      'partyMode', 'tutorial',
      'companion', teacher_snapshot,
      'items', '[]'::jsonb,
      'rings', '[]'::jsonb,
      'progressionConfig', progression_row.version,
      'guidance', tutorial_guidance
    );
  else
    tutorial_ordinal := null;
    teacher_snapshot := null;
    group_max_hp := stats_row.max_hp;
    loadout_snapshot := jsonb_build_object(
      'partyMode', 'solo',
      'companion', null,
      'items', '[]'::jsonb,
      'rings', '[]'::jsonb,
      'progressionConfig', progression_row.version
    );
  end if;
  self_hash := encode(extensions.digest(convert_to(self_snapshot::text, 'UTF8'), 'sha256'), 'hex');
  loadout_hash := encode(
    extensions.digest(convert_to(loadout_snapshot::text, 'UTF8'), 'sha256'), 'hex'
  );

  start_result := public.start_run_v2(
    p_player_id, p_at, self_snapshot, self_hash, loadout_snapshot, loadout_hash
  );
  if start_result->>'status' not in ('applied', 'cached') then return start_result; end if;
  result_run_id := (start_result#>>'{projection,run,id}')::uuid;

  if tutorial_ordinal is not null then
    update game.runs set hp = group_max_hp, max_hp = group_max_hp
    where id = result_run_id and max_hp <> group_max_hp;
    insert into game.tutorial_run_assignments(
      run_id, player_id, tutorial_ordinal, guidance, progression_config_id, teacher_snapshot
    ) values (
      result_run_id, p_player_id, tutorial_ordinal, tutorial_guidance,
      progression_row.id, teacher_snapshot
    ) on conflict (run_id) do nothing;
  end if;
  return jsonb_set(start_result, '{projection}', game.run_projection_v1(result_run_id));
end;
$$;

create function public.run_view_v2(p_player_id uuid, p_run_id uuid default null)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, game, pg_temp
as $$
  select public.run_view_v1($1, $2)
$$;

create function public.prepare_action_v2(
  p_player_id uuid,
  p_run_id uuid,
  p_token_sha256 text,
  p_expected_state_version bigint,
  p_stage smallint,
  p_exchange smallint,
  p_choice_id text,
  p_context_sha256 text,
  p_prepared_resolution jsonb,
  p_resolution_sha256 text,
  p_expires_at timestamptz,
  p_tutorial_adapter jsonb default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
  select case when $12 is null
    then public.prepare_action_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    else jsonb_build_object('status', 'rejected', 'reason', 'tutorial_adapter_not_implemented')
  end
$$;

create function public.resolve_choice_v2(
  p_token_sha256 text,
  p_telegram_update_id bigint,
  p_actor_player_id uuid,
  p_context_sha256 text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
  select public.resolve_choice_v1($1, $2, $3, $4)
$$;

create function public.advance_day_v2(p_at timestamptz)
returns jsonb
language sql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
  select public.advance_day_v1($1)
$$;

create function public.prepare_player_action_v1(
  p_player_id uuid,
  p_token_sha256 text,
  p_expected_profile_version bigint,
  p_expected_message_id bigint,
  p_action jsonb,
  p_context_sha256 text,
  p_expires_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
  select jsonb_build_object('status', 'rejected', 'reason', 'phase4_not_implemented')
$$;

create function public.resolve_player_action_v1(
  p_token_sha256 text,
  p_telegram_update_id bigint,
  p_actor_player_id uuid,
  p_callback_message_id bigint,
  p_context_sha256 text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
  select jsonb_build_object('status', 'rejected', 'reason', 'phase4_not_implemented')
$$;

create function public.request_run_render_v2(p_player_id uuid, p_run_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
  select public.request_run_render_v1($1, $2, 'v2:' || $2::text)
$$;

alter table game.progression_config_versions enable row level security;
alter table game.player_onboarding enable row level security;
alter table game.player_stat_progression enable row level security;
alter table game.tutorial_run_assignments enable row level security;
alter table game.player_equipment enable row level security;
alter table game.player_rings enable row level security;
alter table game.player_offers enable row level security;
alter table game.player_action_tokens enable row level security;
alter table game.processed_player_actions enable row level security;

revoke all on game.progression_config_versions, game.player_onboarding,
  game.player_stat_progression, game.tutorial_run_assignments, game.player_equipment,
  game.player_rings, game.player_offers, game.player_action_tokens,
  game.processed_player_actions from public, anon, authenticated, service_role;

alter function public.telegram_identity_v2(bigint, boolean) owner to postgres;
alter function public.player_home_v1(uuid) owner to postgres;
alter function public.start_run_v3(uuid, timestamptz) owner to postgres;
alter function public.run_view_v2(uuid, uuid) owner to postgres;
alter function public.prepare_action_v2(
  uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz, jsonb
) owner to postgres;
alter function public.resolve_choice_v2(text, bigint, uuid, text) owner to postgres;
alter function public.advance_day_v2(timestamptz) owner to postgres;
alter function public.prepare_player_action_v1(
  uuid, text, bigint, bigint, jsonb, text, timestamptz
) owner to postgres;
alter function public.resolve_player_action_v1(text, bigint, uuid, bigint, text) owner to postgres;
alter function public.request_run_render_v2(uuid, uuid) owner to postgres;

revoke all on function public.telegram_identity_v2(bigint, boolean),
  public.player_home_v1(uuid), public.start_run_v3(uuid, timestamptz),
  public.run_view_v2(uuid, uuid),
  public.prepare_action_v2(
    uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz, jsonb
  ), public.resolve_choice_v2(text, bigint, uuid, text),
  public.advance_day_v2(timestamptz),
  public.prepare_player_action_v1(uuid, text, bigint, bigint, jsonb, text, timestamptz),
  public.resolve_player_action_v1(text, bigint, uuid, bigint, text),
  public.request_run_render_v2(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.telegram_identity_v2(bigint, boolean),
  public.player_home_v1(uuid), public.start_run_v3(uuid, timestamptz),
  public.run_view_v2(uuid, uuid),
  public.prepare_action_v2(
    uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz, jsonb
  ), public.resolve_choice_v2(text, bigint, uuid, text),
  public.advance_day_v2(timestamptz),
  public.prepare_player_action_v1(uuid, text, bigint, bigint, jsonb, text, timestamptz),
  public.resolve_player_action_v1(text, bigint, uuid, bigint, text),
  public.request_run_render_v2(uuid, uuid)
  to service_role;
