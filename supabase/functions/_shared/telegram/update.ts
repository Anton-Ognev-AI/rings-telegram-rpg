export type TelegramCommandName =
  | "start"
  | "privacy"
  | "delete_me"
  | "expedition"
  | "resume"
  | "unknown";

export interface NormalizedCommandUpdate {
  readonly kind: "command";
  readonly updateId: bigint;
  readonly telegramExternalId: bigint;
  readonly chatId: bigint;
  readonly messageId: bigint;
  readonly command: TelegramCommandName;
  readonly argument: string;
}

export interface NormalizedCallbackUpdate {
  readonly kind: "callback";
  readonly updateId: bigint;
  readonly telegramExternalId: bigint;
  readonly chatId: bigint;
  readonly messageId: bigint;
  readonly callbackQueryId: string;
  readonly data: string;
}

export type NormalizedTelegramUpdate = NormalizedCommandUpdate | NormalizedCallbackUpdate;
export type TelegramUpdateErrorCode = "malformed_update" | "unsupported_update";

export class TelegramUpdateError extends Error {
  constructor(readonly code: TelegramUpdateErrorCode) {
    super(code);
    this.name = "TelegramUpdateError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return BigInt(value);
}

function boundedString(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return new TextEncoder().encode(value).byteLength <= maximumBytes ? value : null;
}

function commandName(value: string): TelegramCommandName | null {
  const token = value.trim().split(/\s+/, 1)[0];
  if (!token.startsWith("/")) return null;
  const normalized = token.slice(1).split("@", 1)[0].toLowerCase();
  if (["start", "privacy", "delete_me", "expedition", "resume"].includes(normalized)) {
    return normalized as TelegramCommandName;
  }
  return "unknown";
}

function normalizeCommand(
  updateId: bigint,
  message: Record<string, unknown>,
): NormalizedCommandUpdate {
  const from = isRecord(message.from) ? message.from : null;
  const chat = isRecord(message.chat) ? message.chat : null;
  const text = typeof message.text === "string" ? message.text.trim() : null;
  const telegramExternalId = positiveSafeInteger(from?.id);
  const chatId = positiveSafeInteger(chat?.id);
  const messageId = positiveSafeInteger(message.message_id);
  if (text === null) throw new TelegramUpdateError("malformed_update");
  const command = commandName(text);
  if (
    telegramExternalId === null || chatId === null || messageId === null || command === null
  ) {
    throw new TelegramUpdateError("malformed_update");
  }
  const [, ...argumentParts] = text.split(/\s+/);
  return {
    kind: "command",
    updateId,
    telegramExternalId,
    chatId,
    messageId,
    command,
    argument: argumentParts.join(" ").slice(0, 256),
  };
}

function normalizeCallback(
  updateId: bigint,
  callback: Record<string, unknown>,
): NormalizedCallbackUpdate {
  const from = isRecord(callback.from) ? callback.from : null;
  const message = isRecord(callback.message) ? callback.message : null;
  const chat = message !== null && isRecord(message.chat) ? message.chat : null;
  const telegramExternalId = positiveSafeInteger(from?.id);
  const chatId = positiveSafeInteger(chat?.id);
  const messageId = positiveSafeInteger(message?.message_id);
  const callbackQueryId = boundedString(callback.id, 128);
  const data = boundedString(callback.data, 64);
  if (
    telegramExternalId === null || chatId === null || messageId === null ||
    callbackQueryId === null || data === null
  ) {
    throw new TelegramUpdateError("malformed_update");
  }
  return {
    kind: "callback",
    updateId,
    telegramExternalId,
    chatId,
    messageId,
    callbackQueryId,
    data,
  };
}

export function normalizeTelegramUpdate(value: unknown): NormalizedTelegramUpdate {
  if (!isRecord(value)) throw new TelegramUpdateError("malformed_update");
  const updateId = positiveSafeInteger(value.update_id);
  if (updateId === null) throw new TelegramUpdateError("malformed_update");
  if (isRecord(value.message)) return normalizeCommand(updateId, value.message);
  if (isRecord(value.callback_query)) return normalizeCallback(updateId, value.callback_query);
  throw new TelegramUpdateError("unsupported_update");
}
