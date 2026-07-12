create function game.run_projection_v1(p_run_id uuid)
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
    'selfSnapshot', s.snapshot,
    'loadout', l.snapshot
  )
  from game.runs r
  join game.run_self_snapshots s on s.run_id = r.id
  join lateral (
    select snapshot from game.run_loadout_versions
    where run_id = r.id order by version desc limit 1
  ) l on true
  where r.id = p_run_id
$$;

create function public.start_run_v1(
  p_player_id uuid,
  p_cycle_id date,
  p_self_snapshot jsonb,
  p_self_snapshot_sha256 text,
  p_loadout_snapshot jsonb,
  p_loadout_snapshot_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  player_state game.identity_deletion_state;
  day_row game.dungeon_days%rowtype;
  config_id uuid;
  existing_run_id uuid;
  new_run_id uuid;
  maximum_hp integer;
begin
  select deletion_state into strict player_state from game.players
  where id = p_player_id for update;
  if player_state <> 'active' then
    return jsonb_build_object('status', 'rejected', 'reason', 'identity_deletion_pending');
  end if;
  if jsonb_typeof(p_self_snapshot) <> 'object'
    or jsonb_typeof(p_loadout_snapshot) <> 'object'
    or p_self_snapshot_sha256 !~ '^[0-9a-f]{64}$'
    or p_loadout_snapshot_sha256 !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_snapshot');
  end if;
  maximum_hp := (p_self_snapshot->>'maxHp')::integer;
  if maximum_hp <= 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_snapshot_hp');
  end if;

  select * into strict day_row from game.dungeon_days where cycle_id = p_cycle_id;
  if day_row.status not in ('ready', 'fallback_ready', 'open', 'grace') then
    return jsonb_build_object('status', 'rejected', 'reason', 'day_not_schedulable');
  end if;
  select id into strict config_id from game.config_versions where status = 'active';

  select id into existing_run_id from game.runs
  where player_id = p_player_id and cycle_id = p_cycle_id;
  if found then
    return jsonb_build_object(
      'status', 'cached',
      'projection', game.run_projection_v1(existing_run_id)
    );
  end if;

  insert into game.runs (
    player_id, cycle_id, content_version_id, config_version_id,
    hp, max_hp, boss_hp, status, phase, state_version, stage, exchange, xp_earned
  ) values (
    p_player_id, p_cycle_id, day_row.content_version_id, config_id,
    maximum_hp, maximum_hp, null, 'active', 'awaiting_choice', 0, 1, null, 0
  ) returning id into new_run_id;
  insert into game.run_self_snapshots (run_id, snapshot, snapshot_sha256)
  values (new_run_id, p_self_snapshot, p_self_snapshot_sha256);
  insert into game.run_loadout_versions (run_id, version, snapshot, snapshot_sha256)
  values (new_run_id, 1, p_loadout_snapshot, p_loadout_snapshot_sha256);
  insert into game.xp_accounts (player_id) values (p_player_id)
  on conflict (player_id) do nothing;

  return jsonb_build_object(
    'status', 'applied',
    'projection', game.run_projection_v1(new_run_id)
  );
end;
$$;

create function public.prepare_action_v1(
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
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_row game.runs%rowtype;
  token_row game.action_tokens%rowtype;
  inserted_count integer;
begin
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;
  select * into strict run_row from game.runs where id = p_run_id for update;
  if run_row.player_id <> p_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;
  if run_row.status <> 'active'
    or run_row.state_version <> p_expected_state_version
    or run_row.stage <> p_stage
    or coalesce(run_row.exchange, 0) <> p_exchange
  then
    return jsonb_build_object('status', 'stale');
  end if;
  if p_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'rejected', 'reason', 'expired');
  end if;

  perform game.assert_prepared_resolution_v1(p_prepared_resolution);
  if (p_prepared_resolution#>>'{hp,before}')::integer <> run_row.hp
    or (p_prepared_resolution#>>'{xp,before}')::integer <> run_row.xp_earned
    or (p_stage = 10 and (p_prepared_resolution#>>'{bossHp,before}')::integer <> run_row.boss_hp)
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'resolution_context_mismatch');
  end if;

  insert into game.action_tokens (
    token_sha256, player_id, run_id, expected_state_version, stage, exchange, choice_id,
    context_sha256, prepared_resolution, resolution_sha256, expires_at
  ) values (
    p_token_sha256, p_player_id, p_run_id, p_expected_state_version, p_stage, p_exchange,
    p_choice_id, p_context_sha256, p_prepared_resolution, p_resolution_sha256, p_expires_at
  ) on conflict (token_sha256) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then return jsonb_build_object('status', 'ok'); end if;

  select * into strict token_row from game.action_tokens where token_sha256 = p_token_sha256;
  if token_row.player_id = p_player_id
    and token_row.run_id = p_run_id
    and token_row.expected_state_version = p_expected_state_version
    and token_row.stage = p_stage
    and token_row.exchange = p_exchange
    and token_row.choice_id = p_choice_id
    and token_row.context_sha256 = p_context_sha256
    and token_row.prepared_resolution = p_prepared_resolution
    and token_row.resolution_sha256 = p_resolution_sha256
    and token_row.expires_at = p_expires_at
  then
    return jsonb_build_object('status', 'cached');
  end if;
  raise exception 'action token hash conflict' using errcode = '23505';
end;
$$;

create function public.resolve_choice_v1(
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
  cached_row game.processed_actions%rowtype;
  run_row game.runs%rowtype;
  resolution jsonb;
  xp_result jsonb;
  result_body jsonb;
  result_hash text;
  applied_xp integer;
  next_stage integer;
  next_exchange integer;
  terminal text;
  next_status game.run_status;
  next_phase game.run_phase;
  next_boss_hp integer;
  requested_xp integer;
  current_balance bigint;
begin
  select * into token_row from game.action_tokens
  where token_sha256 = p_token_sha256 for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_token');
  end if;
  if token_row.player_id <> p_actor_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;
  if token_row.context_sha256 <> p_context_sha256 then
    return jsonb_build_object('status', 'rejected', 'reason', 'context_mismatch');
  end if;

  select * into cached_row from game.processed_actions
  where token_sha256 = p_token_sha256;
  if found then
    return jsonb_build_object(
      'status', 'cached', 'result', cached_row.result, 'resultSha256', cached_row.result_sha256
    );
  end if;
  if exists(select 1 from game.processed_actions
    where telegram_update_id = p_telegram_update_id and token_sha256 <> p_token_sha256) then
    return jsonb_build_object('status', 'rejected', 'reason', 'update_id_conflict');
  end if;
  if token_row.expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'rejected', 'reason', 'expired');
  end if;
  if not exists(select 1 from game.players
    where id = p_actor_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;

  select * into strict run_row from game.runs where id = token_row.run_id for update;
  if run_row.status <> 'active'
    or run_row.state_version <> token_row.expected_state_version
    or run_row.stage <> token_row.stage
    or coalesce(run_row.exchange, 0) <> token_row.exchange
  then
    return jsonb_build_object('status', 'stale');
  end if;

  resolution := token_row.prepared_resolution;
  insert into game.run_stage_results (
    run_id, stage, exchange, choice_id, resolution, resolution_sha256
  ) values (
    run_row.id, token_row.stage, token_row.exchange, token_row.choice_id,
    resolution, token_row.resolution_sha256
  );
  requested_xp := (resolution#>>'{xp,delta}')::integer;
  if requested_xp = 0 then
    select balance into strict current_balance from game.xp_accounts
    where player_id = run_row.player_id;
    xp_result := jsonb_build_object(
      'requestedDelta', 0,
      'appliedDelta', 0,
      'capped', false,
      'cached', false,
      'balance', current_balance
    );
  else
    xp_result := game.apply_xp_delta_v1(
      run_row.player_id,
      run_row.cycle_id,
      requested_xp,
      true,
      'run_stage',
      run_row.id,
      format('stage_reward:%s:%s', token_row.stage, token_row.exchange),
      run_row.config_version_id
    );
  end if;
  applied_xp := (xp_result->>'appliedDelta')::integer;
  next_stage := (resolution->>'nextStage')::integer;
  next_exchange := (resolution->>'nextExchange')::integer;
  terminal := resolution->>'terminal';
  next_status := 'active';
  next_phase := run_row.phase;
  next_boss_hp := run_row.boss_hp;

  if terminal is not null then
    next_status := case terminal
      when 'victory' then 'finished_victory'::game.run_status
      when 'contained' then 'finished_contained'::game.run_status
      else 'defeated'::game.run_status
    end;
    if resolution->'bossHp' <> 'null'::jsonb then
      next_boss_hp := (resolution#>>'{bossHp,after}')::integer;
    end if;
  elsif token_row.stage = 10 and token_row.exchange = 1 then
    next_stage := 10;
    next_exchange := 2;
    next_phase := 'boss_exchange_2';
    next_boss_hp := (resolution#>>'{bossHp,after}')::integer;
  elsif next_stage = 10 then
    next_exchange := 1;
    next_phase := 'boss_exchange_1';
    select (payload->>'bossMaxHp')::integer into strict next_boss_hp
    from game.config_versions where id = run_row.config_version_id;
  else
    next_exchange := null;
    next_phase := 'awaiting_choice';
    next_boss_hp := null;
  end if;

  update game.runs set
    status = next_status,
    phase = next_phase,
    state_version = state_version + 1,
    stage = coalesce(next_stage, stage),
    exchange = next_exchange,
    hp = (resolution#>>'{hp,after}')::integer,
    boss_hp = next_boss_hp,
    xp_earned = xp_earned + applied_xp,
    finished_at = case when next_status = 'active' then null else clock_timestamp() end
  where id = run_row.id;

  result_body := jsonb_build_object(
    'status', 'applied',
    'projection', game.run_projection_v1(run_row.id),
    'xp', xp_result,
    'resolutionSha256', token_row.resolution_sha256
  );
  result_hash := encode(
    extensions.digest(convert_to(result_body::text, 'UTF8'), 'sha256'), 'hex'
  );

  insert into game.outbox_messages (logical_key, status, intent_type, payload)
  values (
    format('run:%s:state:%s', run_row.id, run_row.state_version + 1),
    'pending',
    'render_run_state',
    jsonb_build_object(
      'runId', run_row.id,
      'stateVersion', run_row.state_version + 1,
      'resultSha256', result_hash
    )
  );
  insert into game.processed_actions (
    token_sha256, telegram_update_id, status, result, result_sha256
  ) values (p_token_sha256, p_telegram_update_id, 'applied', result_body, result_hash);
  update game.action_tokens set consumed_at = clock_timestamp()
  where token_sha256 = p_token_sha256;
  insert into game.analytics_events (event_name, player_id, run_id, properties)
  values (
    'choice_resolved', run_row.player_id, run_row.id,
    jsonb_build_object('stage', token_row.stage, 'exchange', token_row.exchange, 'status', 'applied')
  );

  return result_body;
end;
$$;

create function public.resume_v1(p_player_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_id uuid;
begin
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;
  select id into run_id from game.runs
  where player_id = p_player_id and status = 'active'
  order by started_at desc limit 1;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return game.run_projection_v1(run_id);
end;
$$;

create function public.begin_identity_deletion_v1(p_player_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  player_row game.players%rowtype;
begin
  select * into strict player_row from game.players where id = p_player_id for update;
  if player_row.deletion_state = 'deletion_pending' then
    if player_row.deletion_id <> p_deletion_id then
      return jsonb_build_object('status', 'rejected', 'reason', 'deletion_id_conflict');
    end if;
    return jsonb_build_object('status', 'cached', 'deletionId', p_deletion_id);
  end if;
  update game.players set
    deletion_state = 'deletion_pending',
    deletion_id = p_deletion_id,
    deletion_requested_at = clock_timestamp()
  where id = p_player_id;
  return jsonb_build_object('status', 'applied', 'deletionId', p_deletion_id);
end;
$$;

create function public.finalize_identity_deletion_v1(p_player_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  player_row game.players%rowtype;
begin
  select * into strict player_row from game.players where id = p_player_id for update;
  if player_row.deletion_state <> 'deletion_pending' or player_row.deletion_id <> p_deletion_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'deletion_context_mismatch');
  end if;
  delete from game.identity_links where player_id = p_player_id;
  update game.players set personal_label = null where id = p_player_id;
  return jsonb_build_object('status', 'applied', 'deletionId', p_deletion_id);
end;
$$;

alter function game.run_projection_v1(uuid) owner to postgres;
alter function public.start_run_v1(uuid, date, jsonb, text, jsonb, text) owner to postgres;
alter function public.prepare_action_v1(uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz) owner to postgres;
alter function public.resolve_choice_v1(text, bigint, uuid, text) owner to postgres;
alter function public.resume_v1(uuid) owner to postgres;
alter function public.begin_identity_deletion_v1(uuid, uuid) owner to postgres;
alter function public.finalize_identity_deletion_v1(uuid, uuid) owner to postgres;

revoke all on function game.run_projection_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function public.start_run_v1(uuid, date, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.prepare_action_v1(uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_choice_v1(text, bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.resume_v1(uuid) from public, anon, authenticated;
revoke all on function public.begin_identity_deletion_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_identity_deletion_v1(uuid, uuid) from public, anon, authenticated;

grant execute on function public.start_run_v1(uuid, date, jsonb, text, jsonb, text) to service_role;
grant execute on function public.prepare_action_v1(uuid, uuid, text, bigint, smallint, smallint, text, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.resolve_choice_v1(text, bigint, uuid, text) to service_role;
grant execute on function public.resume_v1(uuid) to service_role;
grant execute on function public.begin_identity_deletion_v1(uuid, uuid) to service_role;
grant execute on function public.finalize_identity_deletion_v1(uuid, uuid) to service_role;
