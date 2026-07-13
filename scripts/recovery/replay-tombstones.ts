import type { Sql } from "npm:postgres@3.4.7";

export async function replayTombstones(primary: Sql, recovery: Sql): Promise<number> {
  const tombstones = await recovery<{
    surrogate_player_id: string;
    deletion_id: string;
    recorded_at: string;
  }[]>`select surrogate_player_id, deletion_id, recorded_at
    from recovery.deletion_tombstones order by recorded_at, deletion_id`;

  for (const tombstone of tombstones) {
    await primary.begin(async (transaction) => {
      await transaction`update game.players set
        deletion_state = 'deletion_pending',
        deletion_id = ${tombstone.deletion_id}::uuid,
        deletion_requested_at = ${tombstone.recorded_at}::timestamptz,
        personal_label = null
      where id = ${tombstone.surrogate_player_id}::uuid`;
      await transaction`delete from game.identity_links
        where player_id = ${tombstone.surrogate_player_id}::uuid`;
    });
  }
  return tombstones.length;
}
