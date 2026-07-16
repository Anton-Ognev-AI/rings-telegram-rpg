create or replace function public.record_deletion_tombstone_v1(
  p_surrogate_player_id uuid,
  p_deletion_id uuid,
  p_recorded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, recovery, pg_temp
as $$
declare
  stored recovery.deletion_tombstones%rowtype;
begin
  if p_surrogate_player_id is null or p_deletion_id is null or p_recorded_at is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_tombstone');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_surrogate_player_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_deletion_id::text, 1));

  select * into stored
  from recovery.deletion_tombstones
  where surrogate_player_id = p_surrogate_player_id or deletion_id = p_deletion_id
  order by deletion_id
  limit 1
  for update;

  if found then
    if stored.surrogate_player_id = p_surrogate_player_id
      and stored.deletion_id = p_deletion_id
      and stored.recorded_at = p_recorded_at
    then
      return jsonb_build_object('status', 'cached');
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'tombstone_conflict');
  end if;

  insert into recovery.deletion_tombstones(
    surrogate_player_id, deletion_id, recorded_at
  ) values (
    p_surrogate_player_id, p_deletion_id, p_recorded_at
  );
  return jsonb_build_object('status', 'applied');
end;
$$;

alter function public.record_deletion_tombstone_v1(uuid, uuid, timestamptz) owner to postgres;
revoke all on function public.record_deletion_tombstone_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_deletion_tombstone_v1(uuid, uuid, timestamptz)
  to service_role;
