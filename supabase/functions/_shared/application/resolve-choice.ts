import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface ResolveChoiceInput {
  readonly tokenSha256: string;
  readonly telegramUpdateId: bigint;
  readonly actorPlayerId: string;
  readonly contextSha256: string;
}

export function resolveChoice(
  database: DatabasePort,
  input: ResolveChoiceInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("resolve_choice_v3", {
    p_token_sha256: input.tokenSha256,
    p_telegram_update_id: input.telegramUpdateId.toString(),
    p_actor_player_id: input.actorPlayerId,
    p_context_sha256: input.contextSha256,
  });
}
