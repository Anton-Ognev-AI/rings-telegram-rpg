create function game.is_safe_analytics_json(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  entry record;
  item jsonb;
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) = 'object' then
    for entry in
      select pair.key as json_key, pair.value as json_value
      from jsonb_each($1) as pair(key, value)
    loop
      if lower(entry.json_key) = any(array[
        'telegram', 'telegram_id', 'external_id', 'username', 'display_name', 'message', 'text'
      ]) then
        return false;
      end if;
      if not game.is_safe_analytics_json(entry.json_value) then return false; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for item in select jsonb_array_elements($1) loop
      if not game.is_safe_analytics_json(item) then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

create function game.assert_prepared_resolution_v1(value jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, game, pg_temp
as $$
begin
  if jsonb_typeof(value) <> 'object'
    or value->>'resolverVersion' <> 'v1'
    or (value->>'stage')::integer not between 1 and 10
    or coalesce(value->>'choiceId', '') = ''
    or value->>'outcome' not in ('success', 'neutral', 'failure')
    or jsonb_typeof(value->'hp') <> 'object'
    or (value#>>'{hp,before}')::integer < 0
    or (value#>>'{hp,after}')::integer < 0
    or (value#>>'{hp,damage}')::integer < 0
    or (value#>>'{hp,vampHeal}')::integer < 0
    or (value#>>'{hp,postHeal}')::integer < 0
    or jsonb_typeof(value->'xp') <> 'object'
    or (value#>>'{xp,before}')::integer < 0
    or (value#>>'{xp,delta}')::integer not between 0 and 150
    or (value#>>'{xp,after}')::integer < 0
    or not (value->'terminal' = 'null'::jsonb or value->>'terminal' in ('victory', 'contained', 'defeated'))
    or not (value->'nextStage' = 'null'::jsonb or (value->>'nextStage')::integer between 2 and 10)
    or not (value->'nextExchange' = 'null'::jsonb or (value->>'nextExchange')::integer = 2)
  then
    raise exception 'invalid prepared resolution v1' using errcode = '23514';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range or null_value_not_allowed then
    raise exception 'invalid prepared resolution v1' using errcode = '23514';
end;
$$;

create table game.action_tokens (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  player_id uuid not null references game.players(id) on delete cascade,
  run_id uuid not null references game.runs(id) on delete cascade,
  expected_state_version bigint not null check (expected_state_version >= 0),
  stage smallint not null check (stage between 1 and 10),
  exchange smallint not null check (exchange between 0 and 2),
  choice_id text not null check (choice_id <> ''),
  context_sha256 text not null check (context_sha256 ~ '^[0-9a-f]{64}$'),
  prepared_resolution jsonb not null check (jsonb_typeof(prepared_resolution) = 'object'),
  resolution_sha256 text not null check (resolution_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  constraint action_token_exchange_check check (
    (stage < 10 and exchange = 0) or (stage = 10 and exchange between 1 and 2)
  ),
  constraint action_token_expiry_check check (expires_at > created_at)
);

create table game.processed_actions (
  id uuid primary key default gen_random_uuid(),
  token_sha256 text not null unique references game.action_tokens(token_sha256) on delete restrict,
  telegram_update_id bigint not null unique check (telegram_update_id > 0),
  status game.action_status not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

create table game.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  logical_key text not null unique check (logical_key <> ''),
  status game.outbox_status not null default 'pending',
  intent_type text not null check (intent_type <> ''),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and game.is_safe_analytics_json(payload)
  ),
  available_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table game.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name <> ''),
  player_id uuid references game.players(id) on delete set null,
  run_id uuid references game.runs(id) on delete set null,
  properties jsonb not null default '{}'::jsonb check (
    jsonb_typeof(properties) = 'object' and game.is_safe_analytics_json(properties)
  ),
  occurred_at timestamptz not null default clock_timestamp()
);

create function game.guard_action_token()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
declare
  prepared_exchange integer;
begin
  if tg_op = 'UPDATE' and not (
    new.token_sha256 = old.token_sha256
    and new.player_id = old.player_id
    and new.run_id = old.run_id
    and new.expected_state_version = old.expected_state_version
    and new.stage = old.stage
    and new.exchange = old.exchange
    and new.choice_id = old.choice_id
    and new.context_sha256 = old.context_sha256
    and new.prepared_resolution = old.prepared_resolution
    and new.resolution_sha256 = old.resolution_sha256
    and new.expires_at = old.expires_at
    and new.created_at = old.created_at
    and old.consumed_at is null
    and new.consumed_at is not null
  ) then
    raise exception 'immutable prepared action binding' using errcode = '55000';
  end if;

  perform game.assert_prepared_resolution_v1(new.prepared_resolution);
  prepared_exchange := coalesce((new.prepared_resolution->>'exchange')::integer, 0);
  if (new.prepared_resolution->>'stage')::integer <> new.stage
    or prepared_exchange <> new.exchange
    or new.prepared_resolution->>'choiceId' <> new.choice_id
  then
    raise exception 'prepared resolution does not match token binding' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger action_tokens_guard
before insert or update on game.action_tokens
for each row execute function game.guard_action_token();

create trigger processed_actions_immutable
before update or delete on game.processed_actions
for each row execute function game.reject_immutable_change();

create trigger analytics_events_immutable
before update or delete on game.analytics_events
for each row execute function game.reject_immutable_change();

create trigger outbox_touch_updated_at
before update on game.outbox_messages
for each row execute function game.touch_updated_at();

alter table game.action_tokens enable row level security;
alter table game.processed_actions enable row level security;
alter table game.outbox_messages enable row level security;
alter table game.analytics_events enable row level security;

revoke all on game.action_tokens, game.processed_actions, game.outbox_messages,
  game.analytics_events from public, anon, authenticated, service_role;
revoke all on function game.is_safe_analytics_json(jsonb),
  game.assert_prepared_resolution_v1(jsonb), game.guard_action_token()
  from public, anon, authenticated, service_role;
