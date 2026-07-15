import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface TelegramIdentityV2Input {
  readonly telegramExternalId: bigint;
  readonly create: boolean;
}

export function getTelegramIdentityV2(
  database: DatabasePort,
  input: TelegramIdentityV2Input,
): Promise<CommandResult> {
  return database.call<CommandResult>("telegram_identity_v2", {
    p_external_id: input.telegramExternalId.toString(),
    p_create_if_missing: input.create,
  });
}
