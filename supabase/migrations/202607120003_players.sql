create table game.players (
  id uuid primary key default gen_random_uuid(),
  deletion_state game.identity_deletion_state not null default 'active',
  deletion_id uuid,
  deletion_requested_at timestamptz,
  personal_label text check (personal_label is null or length(personal_label) <= 100),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint players_deletion_metadata_check check (
    (deletion_state = 'active' and deletion_id is null and deletion_requested_at is null)
    or
    (deletion_state = 'deletion_pending' and deletion_id is not null and deletion_requested_at is not null)
  )
);

create table game.identity_links (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references game.players(id) on delete cascade,
  platform text not null check (platform = 'telegram'),
  external_id bigint not null check (external_id > 0),
  username text check (username is null or length(username) between 1 and 64),
  created_at timestamptz not null default clock_timestamp(),
  unique (platform, external_id),
  unique (player_id, platform)
);

create table game.player_stats (
  player_id uuid primary key references game.players(id) on delete cascade,
  physical integer not null,
  magical integer not null,
  agility integer not null,
  vitality integer not null,
  defense integer not null,
  max_hp integer not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint player_stats_nonnegative_check check (
    physical >= 0 and magical >= 0 and agility >= 0 and vitality >= 0 and defense >= 0
  ),
  constraint player_stats_positive_hp_check check (max_hp > 0)
);

create trigger players_touch_updated_at
before update on game.players
for each row execute function game.touch_updated_at();

create trigger player_stats_touch_updated_at
before update on game.player_stats
for each row execute function game.touch_updated_at();

alter table game.players enable row level security;
alter table game.identity_links enable row level security;
alter table game.player_stats enable row level security;

revoke all on game.players, game.identity_links, game.player_stats
  from public, anon, authenticated, service_role;
