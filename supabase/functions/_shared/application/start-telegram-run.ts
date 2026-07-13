import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface StartTelegramRunInput {
  readonly playerId: string;
  readonly at: string;
  readonly selfSnapshot: Readonly<Record<string, unknown>>;
  readonly selfSnapshotSha256: string;
  readonly loadoutSnapshot: Readonly<Record<string, unknown>>;
  readonly loadoutSnapshotSha256: string;
}

export function startTelegramRun(
  database: DatabasePort,
  input: StartTelegramRunInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("start_run_v2", {
    p_player_id: input.playerId,
    p_at: input.at,
    p_self_snapshot: input.selfSnapshot,
    p_self_snapshot_sha256: input.selfSnapshotSha256,
    p_loadout_snapshot: input.loadoutSnapshot,
    p_loadout_snapshot_sha256: input.loadoutSnapshotSha256,
  });
}
