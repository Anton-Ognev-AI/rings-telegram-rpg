export interface TelegramButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface TelegramMessageInput {
  readonly chatId: string;
  readonly text: string;
  readonly buttons?: ReadonlyArray<ReadonlyArray<TelegramButton>>;
  readonly parseMode?: "HTML";
  readonly timeoutMs?: number;
}

export interface TelegramEditInput extends TelegramMessageInput {
  readonly messageId: bigint;
}

export interface TelegramCallbackAnswerInput {
  readonly callbackQueryId: string;
  readonly text?: string;
}

export interface TelegramPort {
  answerCallback(input: TelegramCallbackAnswerInput): Promise<void>;
  sendMessage(input: TelegramMessageInput): Promise<{ readonly messageId: bigint }>;
  editMessage(input: TelegramEditInput): Promise<{ readonly messageId: bigint }>;
}

export type TelegramDeliveryErrorKind = "retryable" | "permanent" | "delivery_unknown";

export class TelegramDeliveryError extends Error {
  constructor(
    readonly kind: TelegramDeliveryErrorKind,
    readonly retryAfterSeconds?: number,
  ) {
    super(`telegram_${kind}`);
    this.name = "TelegramDeliveryError";
  }
}
