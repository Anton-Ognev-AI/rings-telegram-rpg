import type { TelegramButton } from "../telegram/port.ts";

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CALLBACK_BYTES_LIMIT = 64;

export interface RenderedCard {
  readonly text: string;
  readonly buttons: ReadonlyArray<ReadonlyArray<TelegramButton>>;
}

function escapedCharacter(character: string): string {
  switch (character) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    case "'":
      return "&#39;";
    default:
      return character;
  }
}

export function truncatePlainText(value: string, limit: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= limit) return characters.join("");
  return characters.slice(0, Math.max(0, limit - 1)).join("").trimEnd() + "…";
}

export function escapeTelegramHtml(value: string): string {
  return Array.from(value, escapedCharacter).join("");
}

function safeTelegramText(value: string): string {
  const output: string[] = [];
  let length = 0;
  for (const character of Array.from(value)) {
    const escaped = escapedCharacter(character);
    const escapedLength = Array.from(escaped).length;
    if (length + escapedLength > TELEGRAM_TEXT_LIMIT - 1) {
      output.push("…");
      break;
    }
    output.push(escaped);
    length += escapedLength;
  }
  return output.join("");
}

function safeButton(button: TelegramButton): TelegramButton {
  if (
    new TextEncoder().encode(button.callbackData).byteLength === 0 ||
    new TextEncoder().encode(button.callbackData).byteLength > TELEGRAM_CALLBACK_BYTES_LIMIT
  ) {
    throw new Error("invalid_telegram_callback_data");
  }
  return {
    text: truncatePlainText(button.text, 64),
    callbackData: button.callbackData,
  };
}

export function renderCard(
  plainText: string,
  buttons: ReadonlyArray<ReadonlyArray<TelegramButton>> = [],
): RenderedCard {
  return {
    text: safeTelegramText(plainText),
    buttons: buttons.map((row) => row.map(safeButton)),
  };
}

export function staticButton(text: string, callbackData: string): TelegramButton {
  return { text, callbackData };
}
