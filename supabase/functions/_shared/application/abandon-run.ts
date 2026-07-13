import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface AbandonRunInput {
  readonly playerId: string;
  readonly runId: string;
}

export function abandonRun(database: DatabasePort, input: AbandonRunInput): Promise<CommandResult> {
  return database.call<CommandResult>("abandon_run_v1", {
    p_player_id: input.playerId,
    p_run_id: input.runId,
  });
}
