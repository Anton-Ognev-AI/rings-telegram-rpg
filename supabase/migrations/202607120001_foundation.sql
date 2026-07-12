create schema game;

revoke all on schema game from public, anon, authenticated, service_role;

create type game.identity_deletion_state as enum (
  'active',
  'deletion_pending'
);

create type game.content_validation_status as enum (
  'validated',
  'fallback_validated',
  'quarantined'
);

create type game.dungeon_day_status as enum (
  'scheduled',
  'ready',
  'fallback_ready',
  'open',
  'grace',
  'closed'
);

create type game.run_status as enum (
  'active',
  'finished_victory',
  'finished_contained',
  'defeated',
  'expired',
  'abandoned',
  'cancelled_safety'
);

create type game.run_phase as enum (
  'awaiting_choice',
  'boss_exchange_1',
  'boss_exchange_2',
  'blocked_by_offer'
);

create type game.action_status as enum (
  'applied',
  'cached',
  'stale',
  'rejected'
);

create type game.outbox_status as enum (
  'pending',
  'leased',
  'sent',
  'delivery_unknown',
  'dead'
);

create function game.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create function game.reject_immutable_change()
returns trigger
language plpgsql
set search_path = pg_catalog, game, pg_temp
as $$
begin
  raise exception 'immutable record: %.%', tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$$;

revoke all on all functions in schema game from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema game
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema game
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema game
  revoke all on functions from public, anon, authenticated, service_role;
