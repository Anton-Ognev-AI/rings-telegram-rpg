import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface PrepareActionInput {
  readonly playerId: string;
  readonly runId: string;
  readonly tokenSha256: string;
  readonly expectedStateVersion: number;
  readonly stage: number;
  readonly exchange: number;
  readonly choiceId: string;
  readonly contextSha256: string;
  readonly preparedResolution: Readonly<Record<string, unknown>>;
  readonly resolutionSha256: string;
  readonly expiresAt: string;
}

export function prepareAction(
  database: DatabasePort,
  input: PrepareActionInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("prepare_action_v1", {
    p_player_id: input.playerId,
    p_run_id: input.runId,
    p_token_sha256: input.tokenSha256,
    p_expected_state_version: input.expectedStateVersion,
    p_stage: input.stage,
    p_exchange: input.exchange,
    p_choice_id: input.choiceId,
    p_context_sha256: input.contextSha256,
    p_prepared_resolution: input.preparedResolution,
    p_resolution_sha256: input.resolutionSha256,
    p_expires_at: input.expiresAt,
  });
}
