import type { CommandResult, DatabasePort } from "./database-port.ts";

export function getTelegramDeletionIdentity(
  database: DatabasePort,
  telegramExternalId: bigint,
): Promise<CommandResult> {
  return database.call<CommandResult>("telegram_deletion_identity_v1", {
    p_external_id: telegramExternalId.toString(),
  });
}
