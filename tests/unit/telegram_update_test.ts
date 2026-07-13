import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  RecordingTelegramPort,
  TelegramDeliveryError,
} from "../../supabase/functions/_shared/telegram/fake.ts";
import {
  normalizeTelegramUpdate,
  TelegramUpdateError,
} from "../../supabase/functions/_shared/telegram/update.ts";

Deno.test("normalizer extracts a supported command without retaining the full message", () => {
  const normalized = normalizeTelegramUpdate({
    update_id: 700000001,
    message: {
      message_id: 41,
      from: { id: 900000001, username: "must_not_survive", first_name: "Secret" },
      chat: { id: 900000001, type: "private", title: "must_not_survive" },
      text: "/start synthetic-invite",
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  });

  assertEquals(normalized, {
    kind: "command",
    updateId: 700000001n,
    telegramExternalId: 900000001n,
    chatId: 900000001n,
    messageId: 41n,
    command: "start",
    argument: "synthetic-invite",
  });
  assertEquals("username" in normalized, false);
  assertEquals("title" in normalized, false);
});

Deno.test("normalizer extracts an opaque callback and discards profile data", () => {
  const normalized = normalizeTelegramUpdate({
    update_id: 700000002,
    callback_query: {
      id: "callback-query-1",
      from: { id: 900000002, username: "discard_me" },
      message: {
        message_id: 42,
        chat: { id: 900000002, type: "private" },
      },
      data: "cb_AQIDBAUGBwgJCgsMDQ4PEA",
    },
  });

  assertEquals(normalized, {
    kind: "callback",
    updateId: 700000002n,
    telegramExternalId: 900000002n,
    chatId: 900000002n,
    messageId: 42n,
    callbackQueryId: "callback-query-1",
    data: "cb_AQIDBAUGBwgJCgsMDQ4PEA",
  });
});

Deno.test("normalizer distinguishes malformed and unsupported updates with safe errors", () => {
  const sensitive = "raw-sensitive-message";
  const malformed = assertThrows(
    () => normalizeTelegramUpdate({ update_id: 1, message: { text: sensitive } }),
    TelegramUpdateError,
  );
  assertEquals(malformed.code, "malformed_update");
  assertEquals(malformed.message.includes(sensitive), false);

  const unsupported = assertThrows(
    () => normalizeTelegramUpdate({ update_id: 2, edited_message: { text: sensitive } }),
    TelegramUpdateError,
  );
  assertEquals(unsupported.code, "unsupported_update");

  const oversized = assertThrows(
    () =>
      normalizeTelegramUpdate({
        update_id: 3,
        callback_query: {
          id: "callback-query-oversized",
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 } },
          data: "x".repeat(65),
        },
      }),
    TelegramUpdateError,
  );
  assertEquals(oversized.code, "malformed_update");
});

Deno.test("recording Telegram port scripts success and classified failures", async () => {
  const port = new RecordingTelegramPort([
    { kind: "success", messageId: 800000001n },
    { kind: "retryable" },
    { kind: "permanent" },
    { kind: "delivery_unknown" },
  ]);
  const sent = await port.sendMessage({ chatId: "900000001", text: "Synthetic" });
  assertEquals(sent, { messageId: 800000001n });

  const retryable = await assertRejects(
    () => port.editMessage({ chatId: "900000001", messageId: 800000001n, text: "Edit" }),
    TelegramDeliveryError,
  );
  assertEquals(retryable.kind, "retryable");
  const permanent = await assertRejects(
    () => port.answerCallback({ callbackQueryId: "callback-1" }),
    TelegramDeliveryError,
  );
  assertEquals(permanent.kind, "permanent");
  const unknown = await assertRejects(
    () => port.sendMessage({ chatId: "900000001", text: "Unknown" }),
    TelegramDeliveryError,
  );
  assertEquals(unknown.kind, "delivery_unknown");

  assertEquals(port.calls.map((call) => call.operation), [
    "sendMessage",
    "editMessage",
    "answerCallback",
    "sendMessage",
  ]);
});
