import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface RequestRunRenderInput {
  readonly playerId: string;
  readonly runId: string;
}

export function requestRunRender(
  database: DatabasePort,
  input: RequestRunRenderInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("request_run_render_v2", {
    p_player_id: input.playerId,
    p_run_id: input.runId,
  });
}

export interface RequestProfileRunRenderInput extends RequestRunRenderInput {
  readonly profileVersion: number;
}

export function requestProfileRunRender(
  database: DatabasePort,
  input: RequestProfileRunRenderInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("request_profile_run_render_v1", {
    p_player_id: input.playerId,
    p_run_id: input.runId,
    p_profile_version: input.profileVersion,
  });
}
