import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface StartOnboardingRunInput {
  readonly playerId: string;
  readonly at: string;
}

export function startOnboardingRun(
  database: DatabasePort,
  input: StartOnboardingRunInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("start_run_v3", {
    p_player_id: input.playerId,
    p_at: input.at,
  });
}
