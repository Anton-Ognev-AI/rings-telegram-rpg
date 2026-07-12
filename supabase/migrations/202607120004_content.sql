create table game.content_versions (
  id uuid primary key default gen_random_uuid(),
  external_id text not null check (external_id <> ''),
  schema_version text not null check (schema_version <> ''),
  resolver_version text not null check (resolver_version <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  validation_status game.content_validation_status not null,
  validation_report jsonb not null check (jsonb_typeof(validation_report) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (external_id, payload_sha256)
);

create table game.dungeon_days (
  cycle_id date primary key,
  content_version_id uuid not null references game.content_versions(id) on delete restrict,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  grace_ends_at timestamptz not null,
  status game.dungeon_day_status not null,
  constraint dungeon_days_kyiv_open_check check (
    opens_at = ((cycle_id + time '09:00') at time zone 'Europe/Kyiv')
  ),
  constraint dungeon_days_kyiv_close_check check (
    closes_at = (((cycle_id + 1) + time '09:00') at time zone 'Europe/Kyiv')
  ),
  constraint dungeon_days_grace_check check (grace_ends_at = closes_at + interval '2 hours')
);

create table game.fallback_content (
  slot text primary key check (slot <> ''),
  content_version_id uuid not null references game.content_versions(id) on delete restrict
);

create function game.guard_dungeon_day_content()
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

  if new.status in ('ready', 'open', 'grace') and content_status <> 'validated' then
    raise exception 'day status % requires validated content', new.status using errcode = '23514';
  end if;
  if new.status = 'fallback_ready' and content_status <> 'fallback_validated' then
    raise exception 'fallback_ready requires fallback_validated content' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function game.guard_fallback_content()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
begin
  if not exists (
    select 1 from game.content_versions
    where id = new.content_version_id and validation_status = 'fallback_validated'
  ) then
    raise exception 'fallback slot requires fallback_validated content' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger content_versions_immutable
before update or delete on game.content_versions
for each row execute function game.reject_immutable_change();

create trigger dungeon_days_validate_content
before insert or update on game.dungeon_days
for each row execute function game.guard_dungeon_day_content();

create trigger fallback_content_validate
before insert or update on game.fallback_content
for each row execute function game.guard_fallback_content();

alter table game.content_versions enable row level security;
alter table game.dungeon_days enable row level security;
alter table game.fallback_content enable row level security;

revoke all on game.content_versions, game.dungeon_days, game.fallback_content
  from public, anon, authenticated, service_role;
revoke all on function game.guard_dungeon_day_content(), game.guard_fallback_content()
  from public, anon, authenticated, service_role;
