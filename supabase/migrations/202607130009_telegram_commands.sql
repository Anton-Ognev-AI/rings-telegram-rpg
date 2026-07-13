alter table game.outbox_messages
  add column leased_by uuid,
  add column lease_id uuid,
  add column last_error_kind text check (
    last_error_kind is null or last_error_kind in (
      'retryable', 'delivery_unknown', 'permanent', 'superseded'
    )
  ),
  add constraint outbox_lease_state_check check (
    (status = 'pending' and leased_by is null and lease_id is null and lease_until is null)
    or
    (status = 'leased' and leased_by is not null and lease_id is not null and lease_until is not null)
    or
    (status in ('sent', 'delivery_unknown', 'dead') and lease_until is null)
  );

create table game.telegram_run_cards (
  run_id uuid primary key references game.runs(id) on delete cascade,
  player_id uuid not null references game.players(id) on delete cascade,
  message_id bigint not null check (message_id > 0),
  last_state_version bigint not null check (last_state_version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (player_id, message_id)
);

create trigger telegram_run_cards_touch_updated_at
before update on game.telegram_run_cards
for each row execute function game.touch_updated_at();

alter table game.telegram_run_cards enable row level security;
revoke all on game.telegram_run_cards from public, anon, authenticated, service_role;

create function game.kyiv_cycle_id_v1(p_at timestamptz)
returns date
language sql
immutable
set search_path = pg_catalog, game, pg_temp
as $$
  select (($1 at time zone 'Europe/Kyiv') - interval '9 hours')::date
$$;

create or replace function game.guard_dungeon_day_content()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
declare
  content_status game.content_validation_status;
begin
  select validation_status into strict content_status
  from game.content_versions
  where id = new.content_version_id;

  if new.status = 'ready' and content_status <> 'validated' then
    raise exception 'ready day requires validated content' using errcode = '23514';
  end if;
  if new.status = 'fallback_ready' and content_status <> 'fallback_validated' then
    raise exception 'fallback_ready requires fallback_validated content' using errcode = '23514';
  end if;
  if new.status in ('open', 'grace')
    and content_status not in ('validated', 'fallback_validated')
  then
    raise exception 'active day requires validated content' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.telegram_identity_v1(
  p_external_id bigint,
  p_create_if_missing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  linked_player_id uuid;
  linked_state game.identity_deletion_state;
  new_player_id uuid;
  was_created boolean;
  stats_payload jsonb;
  xp_balance bigint;
begin
  if p_external_id is null or p_external_id <= 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_external_id');
  end if;
  if p_create_if_missing is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_create_mode');
  end if;

  loop
    select p.id, p.deletion_state into linked_player_id, linked_state
    from game.identity_links il
    join game.players p on p.id = il.player_id
    where il.platform = 'telegram' and il.external_id = p_external_id;

    if found then
      if linked_state <> 'active' then
        return jsonb_build_object('status', 'rejected', 'reason', 'identity_deletion_pending');
      end if;
      was_created := false;
      exit;
    end if;

    if not p_create_if_missing then
      return jsonb_build_object('status', 'none');
    end if;

    insert into game.players default values returning id into new_player_id;
    begin
      insert into game.identity_links(player_id, platform, external_id, username)
      values (new_player_id, 'telegram', p_external_id, null);
      linked_player_id := new_player_id;
      was_created := true;
    exception when unique_violation then
      delete from game.players where id = new_player_id;
      continue;
    end;

    insert into game.player_stats(
      player_id, physical, magical, agility, vitality, defense, max_hp
    ) values (linked_player_id, 5, 5, 5, 5, 5, 40);
    insert into game.xp_accounts(player_id) values (linked_player_id);
    exit;
  end loop;

  select jsonb_build_object(
    'physical', physical,
    'magical', magical,
    'agility', agility,
    'vitality', vitality,
    'defense', defense,
    'maxHp', max_hp
  ) into strict stats_payload
  from game.player_stats where player_id = linked_player_id;
  select balance into strict xp_balance
  from game.xp_accounts where player_id = linked_player_id;

  return jsonb_build_object(
    'status', 'ok',
    'created', was_created,
    'playerId', linked_player_id,
    'stats', stats_payload,
    'xpBalance', xp_balance
  );
end;
$$;

create function public.publish_fallback_day_v1(p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  target_cycle date;
  fallback_id uuid;
  existing_day game.dungeon_days%rowtype;
  inserted_count integer;
begin
  if p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_time');
  end if;
  target_cycle := game.kyiv_cycle_id_v1(p_at);
  select content_version_id into strict fallback_id
  from game.fallback_content where slot = 'daily-v1';

  insert into game.dungeon_days(
    cycle_id, content_version_id, opens_at, closes_at, grace_ends_at, status
  ) values (
    target_cycle,
    fallback_id,
    ((target_cycle + time '09:00') at time zone 'Europe/Kyiv'),
    (((target_cycle + 1) + time '09:00') at time zone 'Europe/Kyiv'),
    ((((target_cycle + 1) + time '09:00') at time zone 'Europe/Kyiv') + interval '2 hours'),
    'fallback_ready'
  ) on conflict (cycle_id) do nothing;
  get diagnostics inserted_count = row_count;

  select * into strict existing_day from game.dungeon_days where cycle_id = target_cycle;
  return jsonb_build_object(
    'status', case when inserted_count = 1 then 'applied' else 'cached' end,
    'cycleId', existing_day.cycle_id,
    'opensAt', existing_day.opens_at,
    'closesAt', existing_day.closes_at,
    'graceEndsAt', existing_day.grace_ends_at,
    'dayStatus', existing_day.status
  );
end;
$$;

create function public.advance_day_v1(p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  days_updated integer;
  runs_expired integer;
begin
  if p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_time');
  end if;

  update game.dungeon_days set status = case
    when p_at >= grace_ends_at then 'closed'::game.dungeon_day_status
    when p_at >= closes_at then 'grace'::game.dungeon_day_status
    when p_at >= opens_at then 'open'::game.dungeon_day_status
    else status
  end
  where p_at >= opens_at
    and status <> case
      when p_at >= grace_ends_at then 'closed'::game.dungeon_day_status
      when p_at >= closes_at then 'grace'::game.dungeon_day_status
      else 'open'::game.dungeon_day_status
    end;
  get diagnostics days_updated = row_count;

  update game.runs r set
    status = 'expired',
    state_version = r.state_version + 1,
    finished_at = p_at
  from game.dungeon_days d
  where r.cycle_id = d.cycle_id
    and r.status = 'active'
    and d.grace_ends_at <= p_at;
  get diagnostics runs_expired = row_count;

  return jsonb_build_object(
    'status', 'ok',
    'daysUpdated', days_updated,
    'runsExpired', runs_expired
  );
end;
$$;

create function public.start_run_v2(
  p_player_id uuid,
  p_at timestamptz,
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
  target_cycle date;
  day_row game.dungeon_days%rowtype;
  active_run_id uuid;
  active_cycle date;
  active_grace_end timestamptz;
  start_result jsonb;
  result_run_id uuid;
  result_state_version bigint;
begin
  if p_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_time');
  end if;
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;

  target_cycle := game.kyiv_cycle_id_v1(p_at);
  select * into day_row from game.dungeon_days where cycle_id = target_cycle;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'day_not_published');
  end if;
  if p_at < day_row.opens_at or p_at >= day_row.closes_at then
    return jsonb_build_object('status', 'rejected', 'reason', 'day_not_open');
  end if;
  if day_row.status not in ('ready', 'fallback_ready', 'open') then
    return jsonb_build_object('status', 'rejected', 'reason', 'day_not_schedulable');
  end if;

  select r.id, r.cycle_id, d.grace_ends_at
    into active_run_id, active_cycle, active_grace_end
  from game.runs r
  join game.dungeon_days d on d.cycle_id = r.cycle_id
  where r.player_id = p_player_id and r.status = 'active'
  for update of r;

  if found and active_cycle <> target_cycle then
    if active_grace_end <= p_at then
      update game.runs set
        status = 'expired',
        state_version = state_version + 1,
        finished_at = p_at
      where id = active_run_id;
    else
      return jsonb_build_object(
        'status', 'rejected', 'reason', 'old_run_active', 'runId', active_run_id
      );
    end if;
  end if;

  start_result := public.start_run_v1(
    p_player_id,
    target_cycle,
    p_self_snapshot,
    p_self_snapshot_sha256,
    p_loadout_snapshot,
    p_loadout_snapshot_sha256
  );
  if start_result->>'status' not in ('applied', 'cached') then
    return start_result;
  end if;

  result_run_id := (start_result#>>'{projection,run,id}')::uuid;
  result_state_version := (start_result#>>'{projection,run,stateVersion}')::bigint;
  insert into game.outbox_messages(logical_key, status, intent_type, payload)
  values (
    format('run:%s:state:%s', result_run_id, result_state_version),
    'pending',
    'render_run_state',
    jsonb_build_object('runId', result_run_id, 'stateVersion', result_state_version)
  ) on conflict (logical_key) do nothing;

  return start_result;
end;
$$;

create function public.run_view_v1(p_player_id uuid, p_run_id uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  selected_run game.runs%rowtype;
  projection jsonb;
  content_payload jsonb;
  cycle_payload jsonb;
  last_resolution jsonb;
  card_payload jsonb;
begin
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;

  if p_run_id is null then
    select * into selected_run from game.runs
    where player_id = p_player_id
    order by (status = 'active') desc, started_at desc
    limit 1;
  else
    select * into selected_run from game.runs where id = p_run_id;
  end if;
  if not found then return jsonb_build_object('status', 'none'); end if;
  if selected_run.player_id <> p_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;

  projection := game.run_projection_v1(selected_run.id);
  select payload into strict content_payload from game.content_versions
  where id = selected_run.content_version_id;
  select jsonb_build_object(
    'cycleId', cycle_id,
    'opensAt', opens_at,
    'closesAt', closes_at,
    'graceEndsAt', grace_ends_at,
    'status', status
  ) into strict cycle_payload from game.dungeon_days
  where cycle_id = selected_run.cycle_id;
  select resolution into last_resolution from game.run_stage_results
  where run_id = selected_run.id
  order by created_at desc limit 1;
  select jsonb_build_object(
    'messageId', message_id::text,
    'lastStateVersion', last_state_version
  ) into card_payload from game.telegram_run_cards where run_id = selected_run.id;

  return jsonb_build_object(
    'status', 'ok',
    'run', projection->'run',
    'selfSnapshot', projection->'selfSnapshot',
    'loadout', projection->'loadout',
    'content', content_payload,
    'cycle', cycle_payload,
    'lastResolution', last_resolution,
    'card', card_payload
  );
end;
$$;

create function public.lease_outbox_v1(
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
  leased_row game.outbox_messages%rowtype;
  messages jsonb := '[]'::jsonb;
  run_id_value uuid;
  player_id_value uuid;
  external_id_value bigint;
  card_message_id bigint;
begin
  if p_worker_id is null or p_at is null or p_limit is null or p_lease_seconds is null
    or p_limit not between 1 and 50
    or p_lease_seconds not between 5 and 300
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_lease_request');
  end if;

  update game.outbox_messages set
    status = 'pending',
    leased_by = null,
    lease_id = null,
    lease_until = null,
    last_error_kind = 'retryable'
  where status = 'leased' and lease_until <= p_at;

  update game.outbox_messages o set
    status = 'sent',
    leased_by = null,
    lease_id = null,
    lease_until = null,
    last_error_kind = 'superseded'
  from game.runs r
  left join game.telegram_run_cards c on c.run_id = r.id
  where o.status = 'pending'
    and o.intent_type = 'render_run_state'
    and r.id = (o.payload->>'runId')::uuid
    and (
      (o.payload->>'stateVersion')::bigint < r.state_version
      or c.last_state_version >= (o.payload->>'stateVersion')::bigint
    );

  for leased_row in
    with candidates as (
      select o.id from game.outbox_messages o
      where o.status = 'pending' and o.available_at <= p_at
        and not exists (
          select 1 from game.outbox_messages active_lease
          where active_lease.status = 'leased'
            and active_lease.payload->>'runId' = o.payload->>'runId'
        )
      order by o.available_at, o.created_at, o.id
      for update skip locked
      limit p_limit
    )
    update game.outbox_messages o set
      status = 'leased',
      leased_by = p_worker_id,
      lease_id = gen_random_uuid(),
      lease_until = p_at + make_interval(secs => p_lease_seconds),
      attempts = o.attempts + 1,
      last_error_kind = null
    from candidates c
    where o.id = c.id
    returning o.*
  loop
    run_id_value := (leased_row.payload->>'runId')::uuid;
    select r.player_id, il.external_id, c.message_id
      into player_id_value, external_id_value, card_message_id
    from game.runs r
    join game.identity_links il on il.player_id = r.player_id and il.platform = 'telegram'
    left join game.telegram_run_cards c on c.run_id = r.id
    where r.id = run_id_value;

    messages := messages || jsonb_build_array(jsonb_build_object(
      'id', leased_row.id,
      'leaseId', leased_row.lease_id,
      'intentType', leased_row.intent_type,
      'payload', leased_row.payload,
      'attempts', leased_row.attempts,
      'playerId', player_id_value,
      'telegramExternalId', external_id_value::text,
      'cardMessageId', card_message_id::text
    ));
  end loop;

  return jsonb_build_object('status', 'ok', 'messages', messages);
end;
$$;

create function public.complete_outbox_v1(
  p_outbox_id uuid,
  p_lease_id uuid,
  p_result text,
  p_telegram_message_id bigint,
  p_retry_at timestamptz,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  outbox_row game.outbox_messages%rowtype;
  run_id_value uuid;
  player_id_value uuid;
  state_version_value bigint;
  existing_message_id bigint;
  terminal_status game.outbox_status;
begin
  if p_outbox_id is null or p_lease_id is null or p_result is null or p_at is null
    or p_result not in ('sent', 'retry', 'delivery_unknown', 'dead', 'superseded')
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_completion');
  end if;

  select * into outbox_row from game.outbox_messages where id = p_outbox_id for update;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_outbox'); end if;

  terminal_status := case p_result
    when 'sent' then 'sent'::game.outbox_status
    when 'superseded' then 'sent'::game.outbox_status
    when 'delivery_unknown' then 'delivery_unknown'::game.outbox_status
    when 'dead' then 'dead'::game.outbox_status
    else null
  end;
  if terminal_status is not null
    and outbox_row.status = terminal_status
    and outbox_row.lease_id = p_lease_id
  then
    if p_result = 'sent' and p_telegram_message_id is not null then
      run_id_value := (outbox_row.payload->>'runId')::uuid;
      select message_id into existing_message_id from game.telegram_run_cards
      where run_id = run_id_value;
      if not found or p_telegram_message_id <> existing_message_id then
        return jsonb_build_object('status', 'rejected', 'reason', 'message_id_conflict');
      end if;
    end if;
    return jsonb_build_object('status', 'cached', 'outboxStatus', outbox_row.status);
  end if;
  if outbox_row.status <> 'leased' or outbox_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'lease_mismatch');
  end if;
  if outbox_row.lease_until <= p_at then
    return jsonb_build_object('status', 'rejected', 'reason', 'lease_expired');
  end if;

  if p_result = 'retry' then
    if p_retry_at is null or p_retry_at <= p_at then
      return jsonb_build_object('status', 'rejected', 'reason', 'invalid_retry_time');
    end if;
    if outbox_row.attempts >= 10 then
      update game.outbox_messages set
        status = 'dead', lease_until = null, last_error_kind = 'permanent'
      where id = p_outbox_id;
      return jsonb_build_object('status', 'applied', 'outboxStatus', 'dead');
    end if;
    update game.outbox_messages set
      status = 'pending',
      available_at = p_retry_at,
      leased_by = null,
      lease_id = null,
      lease_until = null,
      last_error_kind = 'retryable'
    where id = p_outbox_id;
    return jsonb_build_object('status', 'applied', 'outboxStatus', 'pending');
  end if;

  if p_result = 'sent' then
    run_id_value := (outbox_row.payload->>'runId')::uuid;
    state_version_value := (outbox_row.payload->>'stateVersion')::bigint;
    select player_id into strict player_id_value from game.runs where id = run_id_value;
    select message_id into existing_message_id from game.telegram_run_cards
    where run_id = run_id_value for update;
    if found then
      if p_telegram_message_id is not null and p_telegram_message_id <> existing_message_id then
        return jsonb_build_object('status', 'rejected', 'reason', 'message_id_conflict');
      end if;
      update game.telegram_run_cards set
        last_state_version = greatest(last_state_version, state_version_value)
      where run_id = run_id_value;
    else
      if p_telegram_message_id is null or p_telegram_message_id <= 0 then
        return jsonb_build_object('status', 'rejected', 'reason', 'missing_message_id');
      end if;
      insert into game.telegram_run_cards(run_id, player_id, message_id, last_state_version)
      values (run_id_value, player_id_value, p_telegram_message_id, state_version_value);
    end if;
  end if;

  update game.outbox_messages set
    status = terminal_status,
    lease_until = null,
    last_error_kind = case p_result
      when 'delivery_unknown' then 'delivery_unknown'
      when 'dead' then 'permanent'
      when 'superseded' then 'superseded'
      else null
    end
  where id = p_outbox_id;
  return jsonb_build_object('status', 'applied', 'outboxStatus', terminal_status);
end;
$$;

create function public.abandon_run_v1(p_player_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, game, pg_temp
as $$
declare
  run_row game.runs%rowtype;
begin
  if not exists(select 1 from game.players
    where id = p_player_id and deletion_state = 'active') then
    return jsonb_build_object('status', 'rejected', 'reason', 'inactive_player');
  end if;
  select * into run_row from game.runs where id = p_run_id for update;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_run'); end if;
  if run_row.player_id <> p_player_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'actor_mismatch');
  end if;
  if run_row.status = 'abandoned' then
    return jsonb_build_object('status', 'cached', 'runId', run_row.id);
  end if;
  if run_row.status <> 'active' then
    return jsonb_build_object('status', 'rejected', 'reason', 'run_not_active');
  end if;

  update game.runs set
    status = 'abandoned',
    state_version = state_version + 1,
    finished_at = clock_timestamp()
  where id = run_row.id;
  return jsonb_build_object('status', 'applied', 'runId', run_row.id);
end;
$$;

alter function game.kyiv_cycle_id_v1(timestamptz) owner to postgres;
alter function game.guard_dungeon_day_content() owner to postgres;
alter function public.telegram_identity_v1(bigint, boolean) owner to postgres;
alter function public.publish_fallback_day_v1(timestamptz) owner to postgres;
alter function public.advance_day_v1(timestamptz) owner to postgres;
alter function public.start_run_v2(uuid, timestamptz, jsonb, text, jsonb, text) owner to postgres;
alter function public.run_view_v1(uuid, uuid) owner to postgres;
alter function public.lease_outbox_v1(uuid, integer, integer, timestamptz) owner to postgres;
alter function public.complete_outbox_v1(uuid, uuid, text, bigint, timestamptz, timestamptz)
  owner to postgres;
alter function public.abandon_run_v1(uuid, uuid) owner to postgres;

revoke all on function game.kyiv_cycle_id_v1(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.telegram_identity_v1(bigint, boolean)
  from public, anon, authenticated;
revoke all on function public.publish_fallback_day_v1(timestamptz)
  from public, anon, authenticated;
revoke all on function public.advance_day_v1(timestamptz)
  from public, anon, authenticated;
revoke all on function public.start_run_v2(uuid, timestamptz, jsonb, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.run_view_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.lease_outbox_v1(uuid, integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_outbox_v1(uuid, uuid, text, bigint, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.abandon_run_v1(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.telegram_identity_v1(bigint, boolean) to service_role;
grant execute on function public.publish_fallback_day_v1(timestamptz) to service_role;
grant execute on function public.advance_day_v1(timestamptz) to service_role;
grant execute on function public.start_run_v2(uuid, timestamptz, jsonb, text, jsonb, text)
  to service_role;
grant execute on function public.run_view_v1(uuid, uuid) to service_role;
grant execute on function public.lease_outbox_v1(uuid, integer, integer, timestamptz)
  to service_role;
grant execute on function public.complete_outbox_v1(
  uuid, uuid, text, bigint, timestamptz, timestamptz
) to service_role;
grant execute on function public.abandon_run_v1(uuid, uuid) to service_role;
