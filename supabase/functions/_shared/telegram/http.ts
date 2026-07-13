import type { FetchPort } from "../infrastructure/supabase-rpc.ts";
import {
  type TelegramCallbackAnswerInput,
  TelegramDeliveryError,
  type TelegramEditInput,
  type TelegramMessageInput,
  type TelegramPort,
} from "./port.ts";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messagePayload(input: TelegramMessageInput): Readonly<Record<string, unknown>> {
  return {
    chat_id: input.chatId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    ...(input.buttons
      ? {
        reply_markup: {
          inline_keyboard: input.buttons.map((row) =>
            row.map((button) => ({ text: button.text, callback_data: button.callbackData }))
          ),
        },
      }
      : {}),
  };
}

function retryAfter(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body.parameters)) return undefined;
  const value = body.parameters.retry_after;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function apiError(status: number, body: unknown): TelegramDeliveryError {
  const errorCode = isRecord(body) && typeof body.error_code === "number"
    ? body.error_code
    : status;
  if (status === 429 || errorCode === 429) {
    return new TelegramDeliveryError("retryable", retryAfter(body));
  }
  if (status >= 500 || errorCode >= 500) return new TelegramDeliveryError("retryable");
  return new TelegramDeliveryError("permanent");
}

export class TelegramBotApiPort implements TelegramPort {
  readonly #baseUrl: string;

  constructor(
    botToken: string,
    private readonly fetcher: FetchPort = fetch,
  ) {
    if (!/^[0-9]+:[A-Za-z0-9_-]+$/u.test(botToken) || botToken.length > 256) {
      throw new Error("invalid_telegram_bot_token");
    }
    this.#baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async #call(method: string, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.#baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new TelegramDeliveryError("delivery_unknown");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw response.ok
        ? new TelegramDeliveryError("delivery_unknown")
        : apiError(response.status, null);
    }
    if (!response.ok || !isRecord(body) || body.ok !== true) {
      throw apiError(response.status, body);
    }
    return body.result;
  }

  async answerCallback(input: TelegramCallbackAnswerInput): Promise<void> {
    await this.#call("answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      ...(input.text ? { text: input.text } : {}),
    });
  }

  async sendMessage(input: TelegramMessageInput): Promise<{ readonly messageId: bigint }> {
    const result = await this.#call("sendMessage", messagePayload(input));
    if (!isRecord(result) || typeof result.message_id !== "number") {
      throw new TelegramDeliveryError("delivery_unknown");
    }
    return { messageId: BigInt(result.message_id) };
  }

  async editMessage(input: TelegramEditInput): Promise<{ readonly messageId: bigint }> {
    const messageId = Number(input.messageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      throw new TelegramDeliveryError("permanent");
    }
    const result = await this.#call("editMessageText", {
      ...messagePayload(input),
      message_id: messageId,
    });
    if (isRecord(result) && typeof result.message_id === "number") {
      return { messageId: BigInt(result.message_id) };
    }
    if (result === true) return { messageId: input.messageId };
    throw new TelegramDeliveryError("delivery_unknown");
  }
}
