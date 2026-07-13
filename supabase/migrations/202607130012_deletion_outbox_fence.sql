create function game.guard_outbox_active_player_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_id_text text;
  player_state game.identity_deletion_state;
begin
  run_id_text := new.payload->>'runId';
  if run_id_text is null or run_id_text !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return new;
  end if;

  select p.deletion_state into player_state
  from game.runs r join game.players p on p.id = r.player_id
  where r.id = run_id_text::uuid
  for key share of p;
  if not found then return new; end if;
  if player_state <> 'active' then
    raise exception 'inactive_player_outbox' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger outbox_active_player_guard
before insert on game.outbox_messages
for each row execute function game.guard_outbox_active_player_v1();

create function game.guard_identity_unlink_outbox_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
begin
  if exists (
    select 1 from game.outbox_messages o join game.runs r
      on r.id = (o.payload->>'runId')::uuid
    where r.player_id = old.player_id and o.status = 'leased'
  ) then
    raise exception 'outbox_delivery_in_flight' using errcode = '55000';
  end if;

  update game.outbox_messages o set
    status = 'sent',
    lease_until = null,
    last_error_kind = 'superseded'
  from game.runs r
  where r.id = (o.payload->>'runId')::uuid
    and r.player_id = old.player_id
    and o.status = 'pending';
  return old;
end;
$$;

create trigger identity_unlink_outbox_guard
before delete on game.identity_links
for each row execute function game.guard_identity_unlink_outbox_v1();

create function game.supersede_identity_outbox_v1(
  p_player_id uuid,
  p_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  affected integer;
begin
  update game.outbox_messages o set
    status = 'sent',
    lease_until = null,
    last_error_kind = 'superseded'
  from game.runs r
  where r.id = (o.payload->>'runId')::uuid
    and r.player_id = p_player_id
    and (
      o.status = 'pending'
      or (o.status = 'leased' and o.lease_until <= p_at)
    );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.begin_identity_deletion_v2(
  p_player_id uuid,
  p_deletion_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  result jsonb;
  superseded_count integer;
begin
  if p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_time');
  end if;
  result := public.begin_identity_deletion_v1(p_player_id, p_deletion_id);
  if result->>'status' not in ('applied', 'cached') then return result; end if;
  superseded_count := game.supersede_identity_outbox_v1(p_player_id, p_at);
  return result || jsonb_build_object('supersededOutbox', superseded_count);
end;
$$;

create function public.lease_outbox_v2(
  p_worker_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  result jsonb;
  message jsonb;
  safe_messages jsonb := '[]'::jsonb;
  player_id_value uuid;
begin
  result := public.lease_outbox_v1(p_worker_id, p_limit, p_lease_seconds, p_at);
  if result->>'status' <> 'ok' then return result; end if;

  for message in select value from jsonb_array_elements(result->'messages') loop
    begin
      player_id_value := (message->>'playerId')::uuid;
    exception when others then
      player_id_value := null;
    end;
    if player_id_value is null or not exists (
      select 1 from game.players p join game.identity_links il
        on il.player_id = p.id and il.platform = 'telegram'
      where p.id = player_id_value and p.deletion_state = 'active'
    ) then
      update game.outbox_messages set
        status = 'sent',
        lease_until = null,
        last_error_kind = 'superseded'
      where id = (message->>'id')::uuid
        and lease_id = (message->>'leaseId')::uuid
        and status = 'leased';
    else
      safe_messages := safe_messages || jsonb_build_array(message - 'telegramExternalId');
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'messages', safe_messages);
end;
$$;

create function public.authorize_outbox_delivery_v1(
  p_outbox_id uuid,
  p_lease_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  player_id_value uuid;
  player_state game.identity_deletion_state;
  outbox_row game.outbox_messages%rowtype;
  external_id_value bigint;
begin
  if p_outbox_id is null or p_lease_id is null or p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_authorization');
  end if;

  select r.player_id into player_id_value
  from game.outbox_messages o join game.runs r on r.id = (o.payload->>'runId')::uuid
  where o.id = p_outbox_id;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_outbox'); end if;

  select deletion_state into player_state from game.players
  where id = player_id_value for update;
  select * into outbox_row from game.outbox_messages
  where id = p_outbox_id for update;

  if outbox_row.status = 'sent' and outbox_row.lease_id = p_lease_id
    and outbox_row.last_error_kind = 'superseded'
  then
    return jsonb_build_object('status', 'superseded');
  end if;
  if outbox_row.status <> 'leased' or outbox_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'lease_mismatch');
  end if;
  if outbox_row.lease_until <= p_at then
    return jsonb_build_object('status', 'rejected', 'reason', 'lease_expired');
  end if;

  select external_id into external_id_value from game.identity_links
  where player_id = player_id_value and platform = 'telegram';
  if player_state <> 'active' or not found then
    update game.outbox_messages set
      status = 'sent',
      lease_until = null,
      last_error_kind = 'superseded'
    where id = p_outbox_id;
    return jsonb_build_object('status', 'superseded');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'telegramExternalId', external_id_value::text,
    'deliveryDeadline', outbox_row.lease_until
  );
end;
$$;

create function public.finalize_identity_deletion_v2(
  p_player_id uuid,
  p_deletion_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  player_row game.players%rowtype;
begin
  if p_player_id is null or p_deletion_id is null or p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_finalization');
  end if;
  select * into player_row from game.players where id = p_player_id for update;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_player'); end if;
  if player_row.deletion_state <> 'deletion_pending'
    or player_row.deletion_id <> p_deletion_id
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'deletion_context_mismatch');
  end if;

  perform game.supersede_identity_outbox_v1(p_player_id, p_at);
  if exists (
    select 1 from game.outbox_messages o join game.runs r
      on r.id = (o.payload->>'runId')::uuid
    where r.player_id = p_player_id and o.status = 'leased'
  ) then
    return jsonb_build_object('status', 'rejected', 'reason', 'outbox_delivery_in_flight');
  end if;
  return public.finalize_identity_deletion_v1(p_player_id, p_deletion_id);
end;
$$;

alter function game.guard_outbox_active_player_v1() owner to postgres;
alter function game.guard_identity_unlink_outbox_v1() owner to postgres;
alter function game.supersede_identity_outbox_v1(uuid, timestamptz) owner to postgres;
alter function public.begin_identity_deletion_v2(uuid, uuid, timestamptz) owner to postgres;
alter function public.lease_outbox_v2(uuid, integer, integer, timestamptz) owner to postgres;
alter function public.authorize_outbox_delivery_v1(uuid, uuid, timestamptz) owner to postgres;
alter function public.finalize_identity_deletion_v2(uuid, uuid, timestamptz) owner to postgres;

revoke all on function game.guard_outbox_active_player_v1()
  from public, anon, authenticated, service_role;
revoke all on function game.guard_identity_unlink_outbox_v1()
  from public, anon, authenticated, service_role;
revoke all on function game.supersede_identity_outbox_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_identity_deletion_v2(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.lease_outbox_v2(uuid, integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.authorize_outbox_delivery_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.finalize_identity_deletion_v2(uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.begin_identity_deletion_v2(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.lease_outbox_v2(uuid, integer, integer, timestamptz)
  to service_role;
grant execute on function public.authorize_outbox_delivery_v1(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.finalize_identity_deletion_v2(uuid, uuid, timestamptz)
  to service_role;
