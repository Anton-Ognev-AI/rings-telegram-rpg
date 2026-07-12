export interface SendMessageInput {
  chatId: string;
  text: string;
}

export interface TelegramPort {
  send(input: SendMessageInput): Promise<{ messageId: string }>;
}

export class FakeTelegramPort implements TelegramPort {
  readonly sent: SendMessageInput[] = [];

  send(input: SendMessageInput): Promise<{ messageId: string }> {
    this.sent.push({ ...input });
    return Promise.resolve({ messageId: `fake-${this.sent.length}` });
  }
}
