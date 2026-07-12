import type { CommandResult, DatabasePort } from "./database-port.ts";

export function resumeRun(database: DatabasePort, playerId: string): Promise<CommandResult> {
  return database.call<CommandResult>("resume_v1", { p_player_id: playerId });
}
