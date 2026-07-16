import type { NormalizedTelegramUpdate } from "./update.ts";

export type OwnerAllowlistErrorCode = "invalid_owner_allowlist" | "owner_not_allowed";

export class OwnerAllowlistError extends Error {
  constructor(readonly code: OwnerAllowlistErrorCode) {
    super(code);
    this.name = "OwnerAllowlistError";
  }
}

const CANONICAL_POSITIVE_DECIMAL = /^[1-9][0-9]{0,15}$/;
const MAX_NORMALIZED_TELEGRAM_ID = BigInt(Number.MAX_SAFE_INTEGER);

function configuredOwner(value: string): bigint {
  if (!CANONICAL_POSITIVE_DECIMAL.test(value)) {
    throw new OwnerAllowlistError("invalid_owner_allowlist");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_NORMALIZED_TELEGRAM_ID) {
    throw new OwnerAllowlistError("invalid_owner_allowlist");
  }
  return parsed;
}

export function assertOwnerAllowed(
  normalized: NormalizedTelegramUpdate,
  expectedOwnerExternalId: string,
): void {
  const owner = configuredOwner(expectedOwnerExternalId);
  if (
    normalized.telegramExternalId !== owner ||
    normalized.chatId !== normalized.telegramExternalId
  ) {
    throw new OwnerAllowlistError("owner_not_allowed");
  }
}
