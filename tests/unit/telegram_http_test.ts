import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import type { FetchPort } from "../../supabase/functions/_shared/infrastructure/supabase-rpc.ts";
import {
  TelegramBotApiPort,
  TelegramTransportError,
} from "../../supabase/functions/_shared/telegram/http.ts";
import { TelegramDeliveryError } from "../../supabase/functions/_shared/telegram/port.ts";

Deno.test("Telegram HTTP adapter maps send and edit payloads without storing responses", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher: FetchPort = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return await Promise.resolve(Response.json({ ok: true, result: { message_id: 8123 } }));
  };
  const telegram = new TelegramBotApiPort("123456:synthetic-token", fetcher);

  assertEquals((await telegram.sendMessage({ chatId: "7001", text: "Етап" })).messageId, 8123n);
  assertEquals(
    (await telegram.editMessage({ chatId: "7001", messageId: 8123n, text: "Далі" })).messageId,
    8123n,
  );
  assertEquals(requests[0].url.endsWith("/sendMessage"), true);
  assertEquals(requests[0].body.chat_id, "7001");
  assertEquals(requests[1].url.endsWith("/editMessageText"), true);
  assertEquals(requests[1].body.message_id, 8123);
});

Deno.test("Telegram HTTP adapter classifies rate limits and unknown delivery safely", async () => {
  const secret = "123456:never-leak-this";
  const rateLimited = new TelegramBotApiPort(secret, () =>
    Promise.resolve(Response.json({
      ok: false,
      error_code: 429,
      parameters: { retry_after: 9 },
    }, { status: 429 })));
  const rateError = await assertRejects(
    () => rateLimited.sendMessage({ chatId: "7001", text: "test" }),
    TelegramDeliveryError,
  ) as TelegramDeliveryError;
  assertEquals(rateError.kind, "retryable");
  assertEquals(rateError.retryAfterSeconds, 9);
  assertEquals(rateError.message.includes(secret), false);

  const unknown = new TelegramBotApiPort(secret, () => Promise.reject(new TypeError("network")));
  const unknownError = await assertRejects(
    () => unknown.sendMessage({ chatId: "7001", text: "test" }),
    TelegramDeliveryError,
  ) as TelegramDeliveryError;
  assertEquals(unknownError.kind, "delivery_unknown");
  assertEquals(unknownError.message.includes(secret), false);
});

Deno.test("Telegram HTTP adapter separates safe pre-dispatch retry from ambiguous transport loss", async () => {
  const input = { chatId: "7001", text: "test" };
  const beforeDispatch = new TelegramBotApiPort(
    "123456:synthetic-token",
    () => Promise.reject(new TelegramTransportError("before_dispatch")),
  );
  const beforeError = await assertRejects(
    () => beforeDispatch.sendMessage(input),
    TelegramDeliveryError,
  ) as TelegramDeliveryError;
  assertEquals(beforeError.kind, "retryable");

  const serverError = new TelegramBotApiPort(
    "123456:synthetic-token",
    () => Promise.resolve(Response.json({ ok: false, error_code: 500 }, { status: 500 })),
  );
  const retryable = await assertRejects(
    () => serverError.sendMessage(input),
    TelegramDeliveryError,
  ) as TelegramDeliveryError;
  assertEquals(retryable.kind, "retryable");

  const badRequest = new TelegramBotApiPort(
    "123456:synthetic-token",
    () => Promise.resolve(Response.json({ ok: false, error_code: 400 }, { status: 400 })),
  );
  const permanent = await assertRejects(
    () => badRequest.sendMessage(input),
    TelegramDeliveryError,
  ) as TelegramDeliveryError;
  assertEquals(permanent.kind, "permanent");
});
