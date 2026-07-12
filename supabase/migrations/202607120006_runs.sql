create table game.runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references game.players(id) on delete cascade,
  cycle_id date not null references game.dungeon_days(cycle_id) on delete restrict,
  content_version_id uuid not null references game.content_versions(id) on delete restrict,
  config_version_id uuid not null references game.config_versions(id) on delete restrict,
  status game.run_status not null default 'active',
  phase game.run_phase not null default 'awaiting_choice',
  state_version bigint not null default 0 check (state_version >= 0),
  stage smallint not null default 1 check (stage between 1 and 10),
  exchange smallint,
  hp integer not null,
  max_hp integer not null check (max_hp > 0),
  boss_hp integer,
  xp_earned integer not null default 0 check (xp_earned between 0 and 150),
  started_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (player_id, cycle_id),
  constraint runs_hp_check check (hp between 0 and max_hp),
  constraint runs_stage_exchange_check check (
    (stage < 10 and exchange is null and boss_hp is null)
    or (stage = 10 and exchange between 1 and 2 and boss_hp >= 0)
  ),
  constraint runs_phase_check check (
    phase = 'blocked_by_offer'
    or (stage < 10 and phase = 'awaiting_choice')
    or (stage = 10 and exchange = 1 and phase = 'boss_exchange_1')
    or (stage = 10 and exchange = 2 and phase = 'boss_exchange_2')
  ),
  constraint runs_terminal_time_check check (
    (status = 'active' and finished_at is null)
    or (status <> 'active' and finished_at is not null)
  )
);

create unique index runs_one_active_per_player_idx
  on game.runs (player_id) where status = 'active';

create table game.run_self_snapshots (
  run_id uuid primary key references game.runs(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

create table game.run_loadout_versions (
  run_id uuid not null references game.runs(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, version)
);

create table game.run_stage_results (
  run_id uuid not null references game.runs(id) on delete cascade,
  stage smallint not null check (stage between 1 and 10),
  exchange smallint not null check (exchange between 0 and 2),
  choice_id text not null check (choice_id <> ''),
  resolution jsonb not null check (jsonb_typeof(resolution) = 'object'),
  resolution_sha256 text not null check (resolution_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, stage, exchange),
  constraint stage_results_exchange_check check (
    (stage < 10 and exchange = 0) or (stage = 10 and exchange between 1 and 2)
  )
);

create trigger runs_touch_updated_at
before update on game.runs
for each row execute function game.touch_updated_at();

create trigger run_self_snapshots_immutable
before update or delete on game.run_self_snapshots
for each row execute function game.reject_immutable_change();

create trigger run_loadout_versions_immutable
before update or delete on game.run_loadout_versions
for each row execute function game.reject_immutable_change();

create trigger run_stage_results_immutable
before update or delete on game.run_stage_results
for each row execute function game.reject_immutable_change();

alter table game.runs enable row level security;
alter table game.run_self_snapshots enable row level security;
alter table game.run_loadout_versions enable row level security;
alter table game.run_stage_results enable row level security;

revoke all on game.runs, game.run_self_snapshots, game.run_loadout_versions,
  game.run_stage_results from public, anon, authenticated, service_role;
