alter table game.outbox_messages
  add column dispatch_started_at timestamptz;

create function public.lease_outbox_v3(
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
begin
  update game.outbox_messages set
    status = 'delivery_unknown',
    lease_until = null,
    last_error_kind = 'delivery_unknown'
  where status = 'leased'
    and lease_until <= p_at
    and dispatch_started_at is not null;

  return public.lease_outbox_v2(p_worker_id, p_limit, p_lease_seconds, p_at);
end;
$$;

create function public.authorize_outbox_delivery_v2(
  p_outbox_id uuid,
  p_lease_id uuid,
  p_is_new_send boolean,
  p_transport_seconds integer,
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
  has_card boolean;
  delivery_deadline timestamptz;
begin
  if p_outbox_id is null or p_lease_id is null or p_is_new_send is null
    or p_transport_seconds is null or p_transport_seconds not between 5 and 20 or p_at is null
  then
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

  select exists(select 1 from game.telegram_run_cards
    where run_id = (outbox_row.payload->>'runId')::uuid) into has_card;
  if p_is_new_send = has_card then
    return jsonb_build_object('status', 'rejected', 'reason', 'send_mode_mismatch');
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

  delivery_deadline := p_at + make_interval(secs => p_transport_seconds);
  update game.outbox_messages set
    lease_until = delivery_deadline,
    dispatch_started_at = case when p_is_new_send then p_at else null end
  where id = p_outbox_id;

  return jsonb_build_object(
    'status', 'ok',
    'telegramExternalId', external_id_value::text,
    'deliveryDeadline', delivery_deadline
  );
end;
$$;

alter function public.lease_outbox_v3(uuid, integer, integer, timestamptz) owner to postgres;
alter function public.authorize_outbox_delivery_v2(uuid, uuid, boolean, integer, timestamptz)
  owner to postgres;

revoke all on function public.lease_outbox_v3(uuid, integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.authorize_outbox_delivery_v2(uuid, uuid, boolean, integer, timestamptz)
  from public, anon, authenticated;

grant execute on function public.lease_outbox_v3(uuid, integer, integer, timestamptz)
  to service_role;
grant execute on function public.authorize_outbox_delivery_v2(
  uuid, uuid, boolean, integer, timestamptz
) to service_role;
