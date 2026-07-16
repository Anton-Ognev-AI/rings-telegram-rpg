create table game.delivery_unknown_reconciliations (
  outbox_id uuid not null references game.outbox_messages(id) on delete restrict,
  delivery_incident_id uuid not null,
  decision text not null check (
    decision in ('confirm_delivered', 'confirm_not_delivered_and_requeue')
  ),
  telegram_message_id bigint,
  outcome text not null check (outcome in ('delivered', 'requeued', 'superseded')),
  result jsonb not null check (
    jsonb_typeof(result) = 'object' and game.is_safe_analytics_json(result)
  ),
  reconciled_at timestamptz not null,
  primary key (outbox_id, delivery_incident_id),
  constraint delivery_unknown_reconciliation_message_check check (
    (decision = 'confirm_delivered' and telegram_message_id is not null
      and telegram_message_id > 0)
    or
    (decision = 'confirm_not_delivered_and_requeue' and telegram_message_id is null)
  )
);

create function game.guard_delivery_unknown_reconciliation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
begin
  raise exception 'immutable delivery-unknown reconciliation'
    using errcode = '55000';
end;
$$;

create trigger delivery_unknown_reconciliations_append_only
before update or delete on game.delivery_unknown_reconciliations
for each row execute function game.guard_delivery_unknown_reconciliation_v1();

alter table game.delivery_unknown_reconciliations enable row level security;
revoke all on game.delivery_unknown_reconciliations
  from public, anon, authenticated, service_role;
revoke all on function game.guard_delivery_unknown_reconciliation_v1()
  from public, anon, authenticated, service_role;

create function public.reconcile_delivery_unknown_v1(
  p_outbox_id uuid,
  p_delivery_incident_id uuid,
  p_decision text,
  p_telegram_message_id bigint,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  outbox_row game.outbox_messages%rowtype;
  run_row game.runs%rowtype;
  card_row game.telegram_run_cards%rowtype;
  prior_row game.delivery_unknown_reconciliations%rowtype;
  player_id_value uuid;
  player_state game.identity_deletion_state;
  run_id_value uuid;
  state_version_value bigint;
  identity_active boolean := false;
  intent_current boolean := false;
  card_exists boolean := false;
  outcome_value text;
  repair_required boolean := false;
  result_body jsonb;
begin
  if p_outbox_id is null or p_delivery_incident_id is null or p_decision is null
    or p_at is null
    or p_decision not in ('confirm_delivered', 'confirm_not_delivered_and_requeue')
    or (p_decision = 'confirm_delivered'
      and (p_telegram_message_id is null or p_telegram_message_id <= 0))
    or (p_decision = 'confirm_not_delivered_and_requeue'
      and p_telegram_message_id is not null)
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_reconciliation');
  end if;

  begin
    select (o.payload->>'runId')::uuid, r.player_id
      into run_id_value, player_id_value
    from game.outbox_messages o
    left join game.runs r on r.id = (o.payload->>'runId')::uuid
    where o.id = p_outbox_id;
  exception when others then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_outbox_payload');
  end;
  if run_id_value is null then
    if not exists(select 1 from game.outbox_messages where id = p_outbox_id) then
      return jsonb_build_object('status', 'rejected', 'reason', 'unknown_outbox');
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_outbox_payload');
  end if;

  if player_id_value is not null then
    select deletion_state into player_state
    from game.players where id = player_id_value for update;
  end if;

  select * into outbox_row
  from game.outbox_messages where id = p_outbox_id for update;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'unknown_outbox');
  end if;

  select * into prior_row
  from game.delivery_unknown_reconciliations
  where outbox_id = p_outbox_id
    and delivery_incident_id = p_delivery_incident_id;
  if found then
    if prior_row.decision = p_decision
      and prior_row.telegram_message_id is not distinct from p_telegram_message_id
    then
      return prior_row.result || jsonb_build_object('status', 'cached');
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'reconciliation_conflict');
  end if;

  if outbox_row.status <> 'delivery_unknown' then
    return jsonb_build_object('status', 'rejected', 'reason', 'outbox_not_delivery_unknown');
  end if;
  if outbox_row.lease_id is distinct from p_delivery_incident_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'incident_mismatch');
  end if;

  begin
    run_id_value := (outbox_row.payload->>'runId')::uuid;
    state_version_value := (outbox_row.payload->>'stateVersion')::bigint;
  exception when others then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_outbox_payload');
  end;
  if run_id_value is null or state_version_value is null or state_version_value < 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_outbox_payload');
  end if;

  select * into run_row from game.runs where id = run_id_value;
  if found then
    player_id_value := run_row.player_id;
    intent_current := run_row.state_version = state_version_value;
  else
    player_id_value := null;
  end if;

  if player_id_value is not null and player_state is null then
    select deletion_state into player_state
    from game.players where id = player_id_value for update;
  end if;
  if player_id_value is not null and player_state = 'active' then
    select exists(
      select 1 from game.identity_links
      where player_id = player_id_value and platform = 'telegram'
    ) into identity_active;
  end if;

  select * into card_row
  from game.telegram_run_cards where run_id = run_id_value for update;
  card_exists := found;

  if p_decision = 'confirm_not_delivered_and_requeue' then
    if not identity_active or not intent_current or card_exists then
      outcome_value := 'superseded';
      update game.outbox_messages set
        status = 'sent',
        lease_until = null,
        last_error_kind = 'superseded',
        updated_at = p_at
      where id = p_outbox_id;
    else
      outcome_value := 'requeued';
      update game.outbox_messages set
        status = 'pending',
        available_at = p_at,
        leased_by = null,
        lease_id = null,
        lease_until = null,
        dispatch_started_at = null,
        last_error_kind = null,
        updated_at = p_at
      where id = p_outbox_id;
    end if;
  else
    if not identity_active or player_id_value is null then
      outcome_value := 'superseded';
    else
      if card_exists then
        if card_row.message_id <> p_telegram_message_id then
          return jsonb_build_object('status', 'rejected', 'reason', 'message_id_conflict');
        end if;
        update game.telegram_run_cards set
          last_state_version = greatest(last_state_version, state_version_value)
        where run_id = run_id_value;
      else
        insert into game.telegram_run_cards(
          run_id, player_id, message_id, last_state_version
        ) values (
          run_id_value, player_id_value, p_telegram_message_id, state_version_value
        );
      end if;
      if intent_current then
        outcome_value := 'delivered';
      else
        outcome_value := 'superseded';
        repair_required := true;
      end if;
    end if;
    update game.outbox_messages set
      status = 'sent',
      lease_until = null,
      last_error_kind = case when outcome_value = 'delivered' then null else 'superseded' end,
      updated_at = p_at
    where id = p_outbox_id;
  end if;

  result_body := jsonb_build_object(
    'status', 'applied',
    'outcome', outcome_value,
    'outboxStatus', case when outcome_value = 'requeued' then 'pending' else 'sent' end,
    'repairRequired', repair_required
  );
  insert into game.delivery_unknown_reconciliations(
    outbox_id, delivery_incident_id, decision, telegram_message_id,
    outcome, result, reconciled_at
  ) values (
    p_outbox_id, p_delivery_incident_id, p_decision, p_telegram_message_id,
    outcome_value, result_body, p_at
  );
  return result_body;
end;
$$;

alter function public.reconcile_delivery_unknown_v1(
  uuid, uuid, text, bigint, timestamptz
) owner to postgres;
revoke all on function public.reconcile_delivery_unknown_v1(
  uuid, uuid, text, bigint, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_delivery_unknown_v1(
  uuid, uuid, text, bigint, timestamptz
) to service_role;
