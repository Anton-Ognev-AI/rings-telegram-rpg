import type { CommandResult, DatabasePort } from "./database-port.ts";

export function getPlayerHome(
  database: DatabasePort,
  playerId: string,
): Promise<CommandResult> {
  return database.call<CommandResult>("player_home_v1", { p_player_id: playerId });
}
