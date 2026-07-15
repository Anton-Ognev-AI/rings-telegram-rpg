import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface RunViewInput {
  readonly playerId: string;
  readonly runId: string | null;
}

export function getRunView(database: DatabasePort, input: RunViewInput): Promise<CommandResult> {
  return database.call<CommandResult>("run_view_v2", {
    p_player_id: input.playerId,
    p_run_id: input.runId,
  });
}
