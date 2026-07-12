create table game.config_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version <> ''),
  resolver_version text not null check (resolver_version <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null unique check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  daily_xp_cap integer not null check (daily_xp_cap > 0),
  status text not null check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default clock_timestamp()
);

create unique index config_versions_one_active_idx
  on game.config_versions ((status)) where status = 'active';

create table game.feature_flags (
  key text primary key check (key <> ''),
  enabled boolean not null default false,
  config_version_id uuid not null references game.config_versions(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);

create function game.guard_config_version_update()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
begin
  if old.status = 'draft' and new.status in ('draft', 'active') then
    return new;
  end if;

  if old.status = 'active'
    and new.status = 'retired'
    and new.id = old.id
    and new.version = old.version
    and new.resolver_version = old.resolver_version
    and new.payload = old.payload
    and new.payload_sha256 = old.payload_sha256
    and new.daily_xp_cap = old.daily_xp_cap
    and new.created_at = old.created_at
  then
    return new;
  end if;

  raise exception 'immutable configuration version: %', old.version using errcode = '55000';
end;
$$;

create trigger config_versions_guard_update
before update on game.config_versions
for each row execute function game.guard_config_version_update();

create trigger feature_flags_touch_updated_at
before update on game.feature_flags
for each row execute function game.touch_updated_at();

alter table game.config_versions enable row level security;
alter table game.feature_flags enable row level security;

revoke all on game.config_versions, game.feature_flags from public, anon, authenticated, service_role;
revoke all on function game.guard_config_version_update() from public, anon, authenticated, service_role;
