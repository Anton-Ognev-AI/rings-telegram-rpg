create or replace function public.request_run_render_v2(p_player_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_row game.runs%rowtype;
  card_row game.telegram_run_cards%rowtype;
  repair_number integer;
  inserted_id uuid;
begin
  if p_player_id is null or p_run_id is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_render_request');
  end if;
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;
  select * into run_row from game.runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'unknown_run');
  end if;
  if run_row.player_id <> p_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;
  if run_row.status = 'abandoned' then
    return jsonb_build_object('status', 'rejected', 'reason', 'run_not_renderable');
  end if;
  select * into card_row from game.telegram_run_cards
  where run_id = run_row.id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'card_unavailable');
  end if;
  if card_row.last_state_version >= run_row.state_version then
    return jsonb_build_object(
      'status', 'cached', 'reason', 'card_current',
      'runId', run_row.id, 'stateVersion', run_row.state_version
    );
  end if;
  if exists(
    select 1 from game.outbox_messages o
    where o.status in ('pending', 'leased')
      and o.intent_type in ('render_run_state', 'repair_run_state')
      and o.payload->>'runId' = run_row.id::text
      and (o.payload->>'stateVersion')::bigint = run_row.state_version
  ) then
    return jsonb_build_object(
      'status', 'cached', 'reason', 'render_pending',
      'runId', run_row.id, 'stateVersion', run_row.state_version
    );
  end if;
  select count(*)::integer + 1 into repair_number
  from game.outbox_messages o
  where o.intent_type = 'repair_run_state'
    and o.payload->>'runId' = run_row.id::text
    and (o.payload->>'stateVersion')::bigint = run_row.state_version;
  insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values (
    format(
      'repair:v2:%s:state:%s:attempt:%s',
      run_row.id, run_row.state_version, repair_number
    ),
    'pending', 'repair_run_state',
    jsonb_build_object('runId', run_row.id, 'stateVersion', run_row.state_version)
  ) returning id into inserted_id;
  return jsonb_build_object(
    'status', 'applied', 'runId', run_row.id, 'stateVersion', run_row.state_version,
    'outboxId', inserted_id
  );
end;
$$;

alter function public.request_run_render_v2(uuid, uuid) owner to postgres;
revoke all on function public.request_run_render_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_run_render_v2(uuid, uuid) to service_role;

create function public.request_profile_run_render_v1(
  p_player_id uuid,
  p_run_id uuid,
  p_profile_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  onboarding_row game.player_onboarding%rowtype;
  run_row game.runs%rowtype;
  card_row game.telegram_run_cards%rowtype;
  logical_key_value text;
  inserted_id uuid;
begin
  if p_player_id is null or p_run_id is null
    or p_profile_version is null or p_profile_version < 0
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_profile_render_request');
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
  if onboarding_row.profile_version <> p_profile_version then
    return jsonb_build_object('status', 'rejected', 'reason', 'stale_profile_version');
  end if;
  select * into run_row from game.runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'unknown_run');
  end if;
  if run_row.player_id <> p_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;
  if run_row.status = 'abandoned' then
    return jsonb_build_object('status', 'rejected', 'reason', 'run_not_renderable');
  end if;
  select * into card_row from game.telegram_run_cards
  where run_id = run_row.id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'card_unavailable');
  end if;

  logical_key_value := format(
    'profile-render:v1:%s:profile:%s', run_row.id, p_profile_version
  );
  if exists(select 1 from game.outbox_messages where logical_key = logical_key_value) then
    return jsonb_build_object(
      'status', 'cached', 'reason', 'profile_render_recorded',
      'runId', run_row.id, 'stateVersion', run_row.state_version,
      'profileVersion', p_profile_version
    );
  end if;
  if exists(
    select 1 from game.outbox_messages o
    where o.status in ('pending', 'leased')
      and o.intent_type in ('render_run_state', 'repair_run_state')
      and o.payload->>'runId' = run_row.id::text
      and (o.payload->>'stateVersion')::bigint = run_row.state_version
  ) then
    return jsonb_build_object(
      'status', 'cached', 'reason', 'render_pending',
      'runId', run_row.id, 'stateVersion', run_row.state_version,
      'profileVersion', p_profile_version
    );
  end if;

  insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values (
    logical_key_value,
    'pending',
    'repair_run_state',
    jsonb_build_object(
      'runId', run_row.id,
      'stateVersion', run_row.state_version,
      'profileVersion', p_profile_version
    )
  ) returning id into inserted_id;
  return jsonb_build_object(
    'status', 'applied', 'runId', run_row.id, 'stateVersion', run_row.state_version,
    'profileVersion', p_profile_version, 'outboxId', inserted_id
  );
end;
$$;

alter function public.request_profile_run_render_v1(uuid, uuid, bigint) owner to postgres;
revoke all on function public.request_profile_run_render_v1(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.request_profile_run_render_v1(uuid, uuid, bigint)
  to service_role;
