import { assertEquals } from "jsr:@std/assert@1.0.19";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import { FakeTelegramPort } from "../../supabase/functions/_shared/infrastructure/telegram-port.ts";
import { redactRecord } from "../../supabase/functions/_shared/infrastructure/redact.ts";

Deno.test("fixed clock returns a defensive Date copy", () => {
  const clock = new FixedClock("2026-07-12T09:00:00.000Z");
  const first = clock.now();
  first.setUTCFullYear(2000);
  assertEquals(clock.now().toISOString(), "2026-07-12T09:00:00.000Z");
});

Deno.test("fake Telegram port records sent messages", async () => {
  const port = new FakeTelegramPort();
  const result = await port.send({ chatId: "test-chat", text: "Вітаємо" });
  assertEquals(result, { messageId: "fake-1" });
  assertEquals(port.sent, [{ chatId: "test-chat", text: "Вітаємо" }]);
});

Deno.test("redaction removes sensitive values", () => {
  assertEquals(
    redactRecord({
      event: "callback",
      token: "secret",
      telegramActorId: "123",
      authorization: "Bearer value",
    }),
    {
      event: "callback",
      token: "[REDACTED]",
      telegramActorId: "[REDACTED]",
      authorization: "[REDACTED]",
    },
  );
});
