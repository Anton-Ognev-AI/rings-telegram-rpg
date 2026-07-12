create table game.xp_accounts (
  player_id uuid primary key references game.players(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table game.player_cycle_xp_earnings (
  player_id uuid not null references game.players(id) on delete cascade,
  cycle_id date not null,
  earned integer not null default 0 check (earned >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (player_id, cycle_id)
);

create table game.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references game.players(id) on delete cascade,
  cycle_id date not null,
  delta integer not null check (delta <> 0),
  applied_delta integer not null,
  cap_subject boolean not null,
  source_type text not null check (source_type <> ''),
  source_id uuid not null,
  reason text not null check (reason <> ''),
  config_version_id uuid not null references game.config_versions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (player_id, source_type, source_id, reason),
  constraint xp_ledger_sign_check check (
    (delta > 0 and applied_delta between 0 and delta)
    or (delta < 0 and applied_delta = delta)
  ),
  constraint xp_ledger_cap_subject_check check (not cap_subject or delta > 0)
);

create trigger xp_accounts_touch_updated_at
before update on game.xp_accounts
for each row execute function game.touch_updated_at();

create trigger cycle_xp_touch_updated_at
before update on game.player_cycle_xp_earnings
for each row execute function game.touch_updated_at();

create trigger xp_ledger_immutable
before update or delete on game.xp_ledger
for each row execute function game.reject_immutable_change();

create function game.apply_xp_delta_v1(
  p_player_id uuid,
  p_cycle_id date,
  p_delta integer,
  p_cap_subject boolean,
  p_source_type text,
  p_source_id uuid,
  p_reason text,
  p_config_version_id uuid
)
returns jsonb
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
declare
  existing game.xp_ledger%rowtype;
  account game.xp_accounts%rowtype;
  cycle_earnings game.player_cycle_xp_earnings%rowtype;
  daily_cap integer;
  applied integer;
begin
  if p_delta = 0 then
    raise exception 'XP delta cannot be zero' using errcode = '23514';
  end if;
  if p_cap_subject and p_delta < 0 then
    raise exception 'negative XP cannot be cap-subject' using errcode = '23514';
  end if;

  select * into existing
  from game.xp_ledger
  where player_id = p_player_id
    and source_type = p_source_type
    and source_id = p_source_id
    and reason = p_reason;
  if found then
    select * into strict account from game.xp_accounts where player_id = p_player_id;
    return jsonb_build_object(
      'requestedDelta', existing.delta,
      'appliedDelta', existing.applied_delta,
      'capped', existing.applied_delta <> existing.delta,
      'cached', true,
      'balance', account.balance
    );
  end if;

  select daily_xp_cap into strict daily_cap
  from game.config_versions
  where id = p_config_version_id and status in ('active', 'retired');

  insert into game.xp_accounts (player_id) values (p_player_id)
  on conflict (player_id) do nothing;
  select * into strict account from game.xp_accounts
  where player_id = p_player_id for update;

  insert into game.player_cycle_xp_earnings (player_id, cycle_id)
  values (p_player_id, p_cycle_id)
  on conflict (player_id, cycle_id) do nothing;
  select * into strict cycle_earnings from game.player_cycle_xp_earnings
  where player_id = p_player_id and cycle_id = p_cycle_id for update;

  select * into existing
  from game.xp_ledger
  where player_id = p_player_id
    and source_type = p_source_type
    and source_id = p_source_id
    and reason = p_reason;
  if found then
    return jsonb_build_object(
      'requestedDelta', existing.delta,
      'appliedDelta', existing.applied_delta,
      'capped', existing.applied_delta <> existing.delta,
      'cached', true,
      'balance', account.balance
    );
  end if;

  applied := p_delta;
  if p_cap_subject then
    applied := least(p_delta, greatest(0, daily_cap - cycle_earnings.earned));
  end if;
  if account.balance + applied < 0 then
    raise exception 'insufficient XP balance' using errcode = '23514';
  end if;

  insert into game.xp_ledger (
    player_id, cycle_id, delta, applied_delta, cap_subject,
    source_type, source_id, reason, config_version_id
  ) values (
    p_player_id, p_cycle_id, p_delta, applied, p_cap_subject,
    p_source_type, p_source_id, p_reason, p_config_version_id
  );

  update game.xp_accounts set
    balance = balance + applied,
    lifetime_earned = lifetime_earned + greatest(0, applied)
  where player_id = p_player_id
  returning * into account;

  if p_cap_subject then
    update game.player_cycle_xp_earnings set earned = earned + applied
    where player_id = p_player_id and cycle_id = p_cycle_id;
  end if;

  return jsonb_build_object(
    'requestedDelta', p_delta,
    'appliedDelta', applied,
    'capped', applied <> p_delta,
    'cached', false,
    'balance', account.balance
  );
end;
$$;

alter table game.xp_accounts enable row level security;
alter table game.player_cycle_xp_earnings enable row level security;
alter table game.xp_ledger enable row level security;

revoke all on game.xp_accounts, game.player_cycle_xp_earnings, game.xp_ledger
  from public, anon, authenticated, service_role;
revoke all on function game.apply_xp_delta_v1(uuid, date, integer, boolean, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
