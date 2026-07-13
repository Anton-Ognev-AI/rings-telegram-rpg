create function public.telegram_deletion_identity_v1(p_external_id bigint)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, game, pg_temp
as $$
declare
  player_row game.players%rowtype;
begin
  if p_external_id is null or p_external_id <= 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_external_id');
  end if;

  select p.* into player_row
  from game.identity_links il
  join game.players p on p.id = il.player_id
  where il.platform = 'telegram' and il.external_id = p_external_id;
  if not found then return jsonb_build_object('status', 'none'); end if;

  return jsonb_build_object(
    'status', 'ok',
    'playerId', player_row.id,
    'deletionState', player_row.deletion_state,
    'deletionId', player_row.deletion_id,
    'deletionRequestedAt', player_row.deletion_requested_at
  );
end;
$$;

alter function public.telegram_deletion_identity_v1(bigint) owner to postgres;
revoke all on function public.telegram_deletion_identity_v1(bigint)
  from public, anon, authenticated;
grant execute on function public.telegram_deletion_identity_v1(bigint) to service_role;
