alter table game.player_offers
  drop constraint player_offers_offer_kind_check,
  drop constraint player_offer_order_check;

alter table game.player_offers
  add constraint player_offers_offer_kind_check check (
    offer_kind in ('tutorial_item', 'starter_ring', 'field_item')
  ),
  add constraint player_offer_order_check check (
    (sequence = 1 and offer_kind in ('tutorial_item', 'field_item'))
    or (sequence = 2 and offer_kind = 'starter_ring')
  );

create unique index player_offers_one_field_discovery_per_player_idx
  on game.player_offers(player_id)
  where offer_kind = 'field_item';

create table game.run_self_versions (
  run_id uuid not null references game.runs(id) on delete cascade,
  version integer not null check (version > 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_offer_id uuid not null references game.player_offers(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, version)
);

create trigger run_self_versions_immutable
before update or delete on game.run_self_versions
for each row execute function game.reject_immutable_change();

alter table game.run_self_versions enable row level security;
revoke all on game.run_self_versions from public, anon, authenticated, service_role;

create function game.field_discovery_chance_v1(p_stage integer, p_outcome text)
returns integer
language sql
immutable
set search_path = pg_catalog, game, pg_temp
as $$
  select case p_stage
    when 1 then case p_outcome when 'success' then 30 when 'neutral' then 20 when 'failure' then 10 else 0 end
    when 2 then case p_outcome when 'success' then 65 when 'neutral' then 50 when 'failure' then 30 else 0 end
    when 3 then case p_outcome when 'success' then 100 when 'neutral' then 100 when 'failure' then 100 else 0 end
    else 0
  end
$$;

create function game.field_discovery_roll_v1(
  p_run_id uuid,
  p_stage integer,
  p_outcome text
)
returns integer
language sql
immutable
set search_path = pg_catalog, game, extensions, pg_temp
as $$
  select (
    (
      ('x' || substring(encode(extensions.digest(
        convert_to(
          'field-discovery-roll-v1|' || p_run_id::text || '|' || p_stage::text || '|' || p_outcome,
          'UTF8'
        ),
        'sha256'
      ), 'hex') from 1 for 8))::bit(32)::bigint
    ) % 100
  )::integer + 1
$$;

create function game.field_discovery_slot_v1(p_run_id uuid)
returns text
language sql
immutable
set search_path = pg_catalog, game, extensions, pg_temp
as $$
  select case when (
    ('x' || substring(encode(extensions.digest(
      convert_to('field-discovery-slot-v1|' || p_run_id::text, 'UTF8'),
      'sha256'
    ), 'hex') from 1 for 8))::bit(32)::bigint
  ) % 2 = 0 then 'armor' else 'talisman' end
$$;

create function game.tutorial_reward_item_v2(p_player_id uuid)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  armor_occupied boolean;
  talisman_occupied boolean;
  first_stat text;
  selected_slot text;
begin
  select exists(select 1 from game.player_equipment
      where player_id = p_player_id and slot = 'armor'),
    exists(select 1 from game.player_equipment
      where player_id = p_player_id and slot = 'talisman')
  into armor_occupied, talisman_occupied;

  if armor_occupied and talisman_occupied then return null; end if;
  if armor_occupied then
    selected_slot := 'talisman';
  elsif talisman_occupied then
    selected_slot := 'armor';
  else
    select first_purchased_stat into first_stat
    from game.player_onboarding where player_id = p_player_id;
    selected_slot := case when first_stat = 'vitality' then 'talisman' else 'armor' end;
  end if;

  return case selected_slot
    when 'armor' then jsonb_build_object(
      'itemKey', 'training_armor', 'slot', 'armor',
      'rarity', 'ordinary', 'bonuses', jsonb_build_object('defense', 2)
    )
    else jsonb_build_object(
      'itemKey', 'student_talisman', 'slot', 'talisman',
      'rarity', 'ordinary', 'bonuses', jsonb_build_object('maxHp', 4)
    )
  end;
end;
$$;

create or replace function game.credit_tutorial_run_v1(p_run_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  assignment_row game.tutorial_run_assignments%rowtype;
  run_row game.runs%rowtype;
  onboarding_row game.player_onboarding%rowtype;
  result_count integer;
  resolved_reason text;
  grant_result jsonb;
  item_payload jsonb;
begin
  if p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_time');
  end if;
  select * into assignment_row from game.tutorial_run_assignments
  where run_id = p_run_id for update;
  if not found then return jsonb_build_object('status', 'none'); end if;
  if assignment_row.credited_at is not null then
    return jsonb_build_object(
      'status', 'cached', 'ordinal', assignment_row.tutorial_ordinal,
      'reason', assignment_row.credit_reason
    );
  end if;
  select * into strict run_row from game.runs where id = p_run_id for update;
  select count(*)::integer into result_count
  from game.run_stage_results where run_id = p_run_id;

  if run_row.status in ('finished_victory', 'finished_contained') then
    resolved_reason := 'natural_terminal';
  elsif run_row.status = 'defeated' and run_row.hp = 0 then
    resolved_reason := 'hp_zero';
  elsif run_row.status = 'expired' and result_count >= 3 then
    resolved_reason := 'eligible_expiry';
  else
    return jsonb_build_object('status', 'rejected', 'reason', 'tutorial_credit_ineligible');
  end if;

  select * into strict onboarding_row from game.player_onboarding
  where player_id = assignment_row.player_id for update;
  if assignment_row.tutorial_ordinal = 1 then
    if onboarding_row.tutorial_completed <> 0 then
      return jsonb_build_object('status', 'rejected', 'reason', 'tutorial_order_mismatch');
    end if;
    grant_result := game.apply_xp_delta_v1(
      run_row.player_id, run_row.cycle_id, 20, true, 'tutorial_completion', run_row.id,
      'first_tutorial_training_grant', run_row.config_version_id
    );
    update game.player_onboarding set tutorial_completed = 1
    where player_id = run_row.player_id;
  else
    if onboarding_row.tutorial_completed <> 1 then
      return jsonb_build_object('status', 'rejected', 'reason', 'tutorial_order_mismatch');
    end if;
    item_payload := game.tutorial_reward_item_v2(run_row.player_id);
    if item_payload is not null then
      insert into game.player_offers(
        player_id, source_run_id, sequence, offer_kind, payload
      ) values (
        run_row.player_id, run_row.id, 1, 'tutorial_item', item_payload
      ) on conflict (player_id, source_run_id, sequence) do nothing;
    end if;
    insert into game.player_offers(
      player_id, source_run_id, sequence, offer_kind, payload
    ) values (
      run_row.player_id, run_row.id, 2, 'starter_ring',
      jsonb_build_object(
        'color', 'blue', 'rarity', 'ordinary',
        'choices', jsonb_build_array('weapon', 'fire', 'defense', 'healing')
      )
    ) on conflict (player_id, source_run_id, sequence) do nothing;
  end if;

  update game.tutorial_run_assignments set
    credited_at = p_at,
    credit_reason = resolved_reason,
    result_count_at_credit = result_count
  where run_id = p_run_id;
  return jsonb_build_object(
    'status', 'applied', 'ordinal', assignment_row.tutorial_ordinal,
    'reason', resolved_reason, 'resultCount', result_count,
    'grant', grant_result
  );
end;
$$;

create function game.run_projection_v2(p_run_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, game, pg_temp
as $$
  select jsonb_build_object(
    'status', 'ok',
    'run', jsonb_build_object(
      'id', r.id,
      'playerId', r.player_id,
      'cycleId', r.cycle_id,
      'status', r.status,
      'phase', r.phase,
      'stateVersion', r.state_version,
      'stage', r.stage,
      'exchange', r.exchange,
      'hp', r.hp,
      'maxHp', r.max_hp,
      'bossHp', r.boss_hp,
      'xpEarned', r.xp_earned,
      'contentVersionId', r.content_version_id,
      'configVersionId', r.config_version_id
    ),
    'selfSnapshot', coalesce(effective_self.snapshot, original_self.snapshot),
    'loadout', effective_loadout.snapshot
  )
  from game.runs r
  join game.run_self_snapshots original_self on original_self.run_id = r.id
  left join lateral (
    select snapshot from game.run_self_versions
    where run_id = r.id order by version desc limit 1
  ) effective_self on true
  join lateral (
    select snapshot from game.run_loadout_versions
    where run_id = r.id order by version desc limit 1
  ) effective_loadout on true
  where r.id = p_run_id
$$;

create function public.run_view_v3(p_player_id uuid, p_run_id uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  base_view jsonb;
  projection jsonb;
  selected_run_id uuid;
  pending_offer jsonb;
begin
  base_view := public.run_view_v2(p_player_id, p_run_id);
  if base_view->>'status' <> 'ok' then return base_view; end if;
  selected_run_id := (base_view#>>'{run,id}')::uuid;
  projection := game.run_projection_v2(selected_run_id);
  select jsonb_build_object(
    'id', id, 'kind', offer_kind, 'sequence', sequence,
    'sourceRunId', source_run_id, 'payload', payload
  ) into pending_offer
  from game.player_offers
  where player_id = p_player_id
    and source_run_id = selected_run_id
    and offer_kind = 'field_item'
    and status = 'pending';
  return base_view || jsonb_build_object(
    'run', projection->'run',
    'selfSnapshot', projection->'selfSnapshot',
    'loadout', projection->'loadout',
    'pendingOffer', pending_offer
  );
end;
$$;

create function public.prepare_action_v3(
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
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_row game.runs%rowtype;
begin
  select * into run_row from game.runs where id = p_run_id;
  if found and run_row.player_id = p_player_id and run_row.phase = 'blocked_by_offer' then
    return jsonb_build_object('status', 'rejected', 'reason', 'offer_pending');
  end if;
  return public.prepare_action_v2(
    p_player_id, p_run_id, p_token_sha256, p_expected_state_version, p_stage,
    p_exchange, p_choice_id, p_context_sha256, p_prepared_resolution,
    p_resolution_sha256, p_expires_at, p_tutorial_adapter
  );
end;
$$;

create function public.resolve_choice_v3(
  p_token_sha256 text,
  p_telegram_update_id bigint,
  p_actor_player_id uuid,
  p_context_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  token_row game.action_tokens%rowtype;
  assignment_row game.tutorial_run_assignments%rowtype;
  resolved jsonb;
  resolution jsonb;
  run_row game.runs%rowtype;
  chance integer;
  selected_slot text;
  item_payload jsonb;
  inserted_count integer := 0;
begin
  select * into token_row from game.action_tokens where token_sha256 = p_token_sha256;
  resolved := public.resolve_choice_v2(
    p_token_sha256, p_telegram_update_id, p_actor_player_id, p_context_sha256
  );
  if resolved->>'status' <> 'applied' or not found then return resolved; end if;

  resolution := token_row.prepared_resolution;
  select * into assignment_row from game.tutorial_run_assignments
  where run_id = token_row.run_id;
  if not found
    or assignment_row.tutorial_ordinal <> 1
    or token_row.stage not between 1 and 3
    or resolution->>'terminal' is not null
    or exists(select 1 from game.player_offers
      where player_id = token_row.player_id and offer_kind = 'field_item')
    or exists(select 1 from game.player_offers
      where player_id = token_row.player_id and status = 'pending')
    or not exists(select 1 from (values ('armor'), ('talisman')) as slots(slot)
      where not exists(select 1 from game.player_equipment e
        where e.player_id = token_row.player_id and e.slot = slots.slot))
  then
    return resolved || jsonb_build_object('projection', game.run_projection_v2(token_row.run_id));
  end if;

  chance := game.field_discovery_chance_v1(token_row.stage, resolution->>'outcome');
  if game.field_discovery_roll_v1(
      token_row.run_id, token_row.stage, resolution->>'outcome'
    ) > chance
  then
    return resolved || jsonb_build_object('projection', game.run_projection_v2(token_row.run_id));
  end if;

  if exists(select 1 from game.player_equipment
      where player_id = token_row.player_id and slot = 'armor') then
    selected_slot := 'talisman';
  elsif exists(select 1 from game.player_equipment
      where player_id = token_row.player_id and slot = 'talisman') then
    selected_slot := 'armor';
  else
    selected_slot := game.field_discovery_slot_v1(token_row.run_id);
  end if;
  item_payload := case selected_slot
    when 'armor' then jsonb_build_object(
      'itemKey', 'training_armor', 'slot', 'armor', 'rarity', 'ordinary',
      'bonuses', jsonb_build_object('defense', 2),
      'sourceStage', token_row.stage, 'outcome', resolution->>'outcome'
    )
    else jsonb_build_object(
      'itemKey', 'student_talisman', 'slot', 'talisman', 'rarity', 'ordinary',
      'bonuses', jsonb_build_object('maxHp', 4),
      'sourceStage', token_row.stage, 'outcome', resolution->>'outcome'
    )
  end;

  insert into game.player_offers(player_id, source_run_id, sequence, offer_kind, payload)
  values (token_row.player_id, token_row.run_id, 1, 'field_item', item_payload)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    update game.runs set phase = 'blocked_by_offer'
    where id = token_row.run_id and status = 'active';
  end if;
  select * into run_row from game.runs where id = token_row.run_id;
  return resolved || jsonb_build_object('projection', game.run_projection_v2(run_row.id));
end;
$$;

create function public.resolve_player_action_v2(
  p_token_sha256 text,
  p_telegram_update_id bigint,
  p_actor_player_id uuid,
  p_callback_message_id bigint,
  p_context_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  token_row game.player_action_tokens%rowtype;
  cached_row game.processed_player_actions%rowtype;
  onboarding_row game.player_onboarding%rowtype;
  offer_row game.player_offers%rowtype;
  run_row game.runs%rowtype;
  action_kind text;
  target_item_key text;
  target_slot text;
  target_bonuses jsonb;
  old_projection jsonb;
  build_projection jsonb;
  previous_loadout jsonb;
  next_self jsonb;
  next_loadout jsonb;
  next_version integer;
  max_hp_delta integer := 0;
  result_body jsonb;
  result_hash text;
begin
  select * into token_row from game.player_action_tokens
  where token_sha256 = p_token_sha256;
  if not found or token_row.action->>'kind' not in ('accept_item', 'discard_item') then
    return public.resolve_player_action_v1(
      p_token_sha256, p_telegram_update_id, p_actor_player_id,
      p_callback_message_id, p_context_sha256
    );
  end if;
  select * into offer_row from game.player_offers
  where id = (token_row.action->>'offerId')::uuid;
  if not found or offer_row.offer_kind <> 'field_item' then
    return public.resolve_player_action_v1(
      p_token_sha256, p_telegram_update_id, p_actor_player_id,
      p_callback_message_id, p_context_sha256
    );
  end if;

  if p_telegram_update_id <= 0 or p_callback_message_id <= 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_binding');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('telegram_update:' || p_telegram_update_id::text, 0)
  );
  if exists(select 1 from game.processed_actions
    where telegram_update_id = p_telegram_update_id) then
    return jsonb_build_object('status', 'rejected', 'reason', 'update_id_conflict');
  end if;
  select * into token_row from game.player_action_tokens
  where token_sha256 = p_token_sha256 for update;
  if token_row.player_id <> p_actor_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;
  if token_row.expected_message_id <> p_callback_message_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'message_mismatch');
  end if;
  if token_row.context_sha256 <> p_context_sha256 then
    return jsonb_build_object('status', 'rejected', 'reason', 'context_mismatch');
  end if;
  select * into cached_row from game.processed_player_actions
  where token_sha256 = p_token_sha256;
  if found then
    return jsonb_build_object(
      'status', 'cached', 'result', cached_row.result,
      'resultSha256', cached_row.result_sha256
    );
  end if;
  if exists(select 1 from game.processed_player_actions
    where telegram_update_id = p_telegram_update_id
      and token_sha256 <> p_token_sha256) then
    return jsonb_build_object('status', 'rejected', 'reason', 'update_id_conflict');
  end if;
  if token_row.expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'rejected', 'reason', 'expired');
  end if;
  if not exists(select 1 from game.players
    where id = p_actor_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;
  select * into onboarding_row from game.player_onboarding
  where player_id = p_actor_player_id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'onboarding_not_initialized');
  end if;
  if onboarding_row.profile_version <> token_row.expected_profile_version then
    return jsonb_build_object('status', 'stale');
  end if;
  select * into offer_row from game.player_offers
  where id = (token_row.action->>'offerId')::uuid
    and player_id = p_actor_player_id for update;
  if not found or offer_row.offer_kind <> 'field_item' or offer_row.status <> 'pending' then
    return jsonb_build_object('status', 'stale');
  end if;
  select * into run_row from game.runs where id = offer_row.source_run_id for update;
  if not found or run_row.player_id <> p_actor_player_id
    or run_row.status <> 'active' or run_row.phase <> 'blocked_by_offer' then
    return jsonb_build_object('status', 'rejected', 'reason', 'field_offer_unavailable');
  end if;

  action_kind := token_row.action->>'kind';
  if action_kind = 'accept_item' then
    target_item_key := offer_row.payload->>'itemKey';
    target_slot := offer_row.payload->>'slot';
    target_bonuses := offer_row.payload->'bonuses';
    if not (
      (target_item_key = 'training_armor' and target_slot = 'armor'
        and target_bonuses = jsonb_build_object('defense', 2))
      or (target_item_key = 'student_talisman' and target_slot = 'talisman'
        and target_bonuses = jsonb_build_object('maxHp', 4))
    ) or exists(select 1 from game.player_equipment
      where player_id = p_actor_player_id and slot = target_slot)
    then
      return jsonb_build_object('status', 'rejected', 'reason', 'invalid_field_offer');
    end if;

    old_projection := game.run_projection_v2(run_row.id);
    insert into game.player_equipment(player_id, slot, item_key, rarity, bonuses)
    values (p_actor_player_id, target_slot, target_item_key, 'ordinary', target_bonuses);
    build_projection := game.player_build_projection_v1(p_actor_player_id);
    if build_projection->>'status' <> 'ok' then
      raise exception 'field discovery produced invalid build' using errcode = '55000';
    end if;
    select snapshot, version + 1 into previous_loadout, next_version
    from game.run_loadout_versions where run_id = run_row.id
    order by version desc limit 1;
    next_self := build_projection->'selfSnapshot';
    next_loadout := previous_loadout
      || (build_projection->'loadoutSnapshot')
      || jsonb_build_object('buildBreakdown', build_projection->'breakdown');
    max_hp_delta := (next_self->>'maxHp')::integer
      - (old_projection#>>'{selfSnapshot,maxHp}')::integer;
    insert into game.run_self_versions(
      run_id, version, snapshot, snapshot_sha256, source_offer_id
    ) values (
      run_row.id, next_version, next_self,
      encode(extensions.digest(convert_to(next_self::text, 'UTF8'), 'sha256'), 'hex'),
      offer_row.id
    );
    insert into game.run_loadout_versions(run_id, version, snapshot, snapshot_sha256)
    values (
      run_row.id, next_version, next_loadout,
      encode(extensions.digest(convert_to(next_loadout::text, 'UTF8'), 'sha256'), 'hex')
    );
  end if;

  update game.player_offers set
    status = case action_kind when 'accept_item' then 'accepted' else 'discarded' end,
    resolved_at = clock_timestamp()
  where id = offer_row.id;
  update game.player_onboarding set profile_version = profile_version + 1
  where player_id = p_actor_player_id;
  update game.runs set
    phase = 'awaiting_choice',
    state_version = state_version + 1,
    max_hp = max_hp + max_hp_delta,
    hp = hp + max_hp_delta
  where id = run_row.id;

  insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values (
    format('field-offer:%s:state:%s', run_row.id, run_row.state_version + 1),
    'pending', 'render_run_state',
    jsonb_build_object('runId', run_row.id, 'stateVersion', run_row.state_version + 1)
  );
  select * into strict onboarding_row from game.player_onboarding
  where player_id = p_actor_player_id;
  result_body := jsonb_build_object(
    'status', 'applied',
    'profileVersion', onboarding_row.profile_version,
    'action', token_row.action,
    'home', public.player_home_v1(p_actor_player_id),
    'runView', public.run_view_v3(p_actor_player_id, run_row.id)
  );
  result_hash := encode(
    extensions.digest(convert_to(result_body::text, 'UTF8'), 'sha256'), 'hex'
  );
  insert into game.processed_player_actions(
    token_sha256, player_id, telegram_update_id, status, result, result_sha256
  ) values (
    p_token_sha256, p_actor_player_id, p_telegram_update_id,
    'applied', result_body, result_hash
  );
  update game.player_action_tokens set consumed_at = clock_timestamp()
  where token_sha256 = p_token_sha256;
  return result_body;
end;
$$;

alter function game.field_discovery_chance_v1(integer, text) owner to postgres;
alter function game.field_discovery_roll_v1(uuid, integer, text) owner to postgres;
alter function game.field_discovery_slot_v1(uuid) owner to postgres;
alter function game.tutorial_reward_item_v2(uuid) owner to postgres;
alter function game.run_projection_v2(uuid) owner to postgres;
alter function public.run_view_v3(uuid, uuid) owner to postgres;
alter function public.prepare_action_v3(
  uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz, jsonb
) owner to postgres;
alter function public.resolve_choice_v3(text, bigint, uuid, text) owner to postgres;
alter function public.resolve_player_action_v2(text, bigint, uuid, bigint, text) owner to postgres;

revoke all on function game.field_discovery_chance_v1(integer, text),
  game.field_discovery_roll_v1(uuid, integer, text),
  game.field_discovery_slot_v1(uuid),
  game.tutorial_reward_item_v2(uuid),
  game.run_projection_v2(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.run_view_v3(uuid, uuid),
  public.prepare_action_v3(
    uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz, jsonb
  ),
  public.resolve_choice_v3(text, bigint, uuid, text),
  public.resolve_player_action_v2(text, bigint, uuid, bigint, text)
  from public, anon, authenticated;

grant execute on function public.run_view_v3(uuid, uuid),
  public.prepare_action_v3(
    uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz, jsonb
  ),
  public.resolve_choice_v3(text, bigint, uuid, text),
  public.resolve_player_action_v2(text, bigint, uuid, bigint, text)
  to service_role;
