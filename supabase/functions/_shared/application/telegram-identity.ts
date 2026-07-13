import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface TelegramIdentityInput {
  readonly telegramExternalId: bigint;
  readonly create: boolean;
}

export function getTelegramIdentity(
  database: DatabasePort,
  input: TelegramIdentityInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("telegram_identity_v1", {
    p_external_id: input.telegramExternalId.toString(),
    p_create_if_missing: input.create,
  });
}
