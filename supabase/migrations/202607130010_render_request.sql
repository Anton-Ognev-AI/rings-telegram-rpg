create function public.request_run_render_v1(
  p_player_id uuid,
  p_run_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_row game.runs%rowtype;
  request_hash text;
  logical_key_value text;
  inserted_id uuid;
begin
  if p_player_id is null or p_run_id is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_render_request');
  end if;
  if p_request_key is null or p_request_key !~ '^[1-9][0-9]{0,19}$' then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_request_key');
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
  if not exists(select 1 from game.telegram_run_cards where run_id = run_row.id) then
    return jsonb_build_object('status', 'rejected', 'reason', 'card_unavailable');
  end if;

  if exists(
    select 1 from game.outbox_messages o
    where o.status in ('pending', 'leased')
      and o.intent_type in ('render_run_state', 'repair_run_state')
      and o.payload->>'runId' = run_row.id::text
      and (o.payload->>'stateVersion')::bigint = run_row.state_version
  ) then
    return jsonb_build_object(
      'status', 'cached',
      'reason', 'render_pending',
      'runId', run_row.id,
      'stateVersion', run_row.state_version
    );
  end if;

  request_hash := encode(
    extensions.digest(convert_to(p_request_key, 'UTF8'), 'sha256'), 'hex'
  );
  logical_key_value := format(
    'repair:%s:state:%s:request:%s', run_row.id, run_row.state_version, request_hash
  );
  insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values (
    logical_key_value,
    'pending',
    'repair_run_state',
    jsonb_build_object('runId', run_row.id, 'stateVersion', run_row.state_version)
  )
  on conflict (logical_key) do nothing
  returning id into inserted_id;

  return jsonb_build_object(
    'status', case when inserted_id is null then 'cached' else 'applied' end,
    'runId', run_row.id,
    'stateVersion', run_row.state_version
  );
end;
$$;

alter function public.request_run_render_v1(uuid, uuid, text) owner to postgres;
revoke all on function public.request_run_render_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_run_render_v1(uuid, uuid, text) to service_role;
