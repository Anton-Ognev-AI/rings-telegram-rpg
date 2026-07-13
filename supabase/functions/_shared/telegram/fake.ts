import {
  type TelegramCallbackAnswerInput,
  TelegramDeliveryError,
  type TelegramDeliveryErrorKind,
  type TelegramEditInput,
  type TelegramMessageInput,
  type TelegramPort,
} from "./port.ts";

export { TelegramDeliveryError } from "./port.ts";

export type ScriptedTelegramOutcome =
  | { readonly kind: "success"; readonly messageId?: bigint }
  | { readonly kind: TelegramDeliveryErrorKind; readonly retryAfterSeconds?: number };

export type RecordedTelegramCall =
  | { readonly operation: "answerCallback"; readonly input: TelegramCallbackAnswerInput }
  | { readonly operation: "sendMessage"; readonly input: TelegramMessageInput }
  | { readonly operation: "editMessage"; readonly input: TelegramEditInput };

function copyButtons(
  buttons: TelegramMessageInput["buttons"],
): TelegramMessageInput["buttons"] {
  return buttons?.map((row) => row.map((button) => ({ ...button })));
}

export class RecordingTelegramPort implements TelegramPort {
  readonly calls: RecordedTelegramCall[] = [];
  readonly #outcomes: ScriptedTelegramOutcome[];
  #nextMessageId = 810000000n;

  constructor(outcomes: ReadonlyArray<ScriptedTelegramOutcome> = []) {
    this.#outcomes = [...outcomes];
  }

  #takeOutcome(): ScriptedTelegramOutcome {
    return this.#outcomes.shift() ?? { kind: "success" };
  }

  #applyOutcome(outcome: ScriptedTelegramOutcome): bigint | undefined {
    if (outcome.kind !== "success") {
      throw new TelegramDeliveryError(outcome.kind, outcome.retryAfterSeconds);
    }
    return outcome.messageId;
  }

  answerCallback(input: TelegramCallbackAnswerInput): Promise<void> {
    this.calls.push({ operation: "answerCallback", input: { ...input } });
    const outcome = this.#takeOutcome();
    return Promise.resolve().then(() => {
      this.#applyOutcome(outcome);
    });
  }

  sendMessage(input: TelegramMessageInput): Promise<{ readonly messageId: bigint }> {
    this.calls.push({
      operation: "sendMessage",
      input: { ...input, buttons: copyButtons(input.buttons) },
    });
    const outcome = this.#takeOutcome();
    return Promise.resolve().then(() => {
      const scriptedMessageId = this.#applyOutcome(outcome);
      const messageId = scriptedMessageId ?? this.#nextMessageId;
      this.#nextMessageId += 1n;
      return { messageId };
    });
  }

  editMessage(input: TelegramEditInput): Promise<{ readonly messageId: bigint }> {
    this.calls.push({
      operation: "editMessage",
      input: { ...input, buttons: copyButtons(input.buttons) },
    });
    const outcome = this.#takeOutcome();
    return Promise.resolve().then(() => {
      this.#applyOutcome(outcome);
      return { messageId: input.messageId };
    });
  }
}
