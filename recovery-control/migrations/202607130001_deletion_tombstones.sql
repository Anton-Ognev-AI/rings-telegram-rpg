create schema if not exists recovery;
revoke all on schema recovery from public;

create table if not exists recovery.deletion_tombstones (
  surrogate_player_id uuid not null,
  deletion_id uuid not null unique,
  recorded_at timestamptz not null,
  primary key (surrogate_player_id, deletion_id)
);

revoke all on recovery.deletion_tombstones from public;
