import { assertEquals } from "jsr:@std/assert@1.0.19";
import { verifyTelegramSecret } from "../../supabase/functions/_shared/telegram/security.ts";

function requestWithSecret(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set("X-Telegram-Bot-Api-Secret-Token", secret);
  return new Request("http://127.0.0.1/tg-webhook", { method: "POST", headers });
}

Deno.test("Telegram webhook secret accepts only the exact bounded value", async () => {
  const expected = "local-synthetic-secret";
  assertEquals(await verifyTelegramSecret(requestWithSecret(expected), expected), true);
  assertEquals(await verifyTelegramSecret(requestWithSecret(), expected), false);
  assertEquals(await verifyTelegramSecret(requestWithSecret("wrong-secret"), expected), false);
  assertEquals(await verifyTelegramSecret(requestWithSecret(expected), ""), false);
  assertEquals(await verifyTelegramSecret(requestWithSecret("x".repeat(257)), expected), false);
  assertEquals(await verifyTelegramSecret(requestWithSecret(expected), "x".repeat(257)), false);
});

Deno.test("Telegram secret rejection never exposes either secret", async () => {
  const supplied = "attacker-controlled-secret";
  const expected = "server-side-secret";
  const accepted = await verifyTelegramSecret(requestWithSecret(supplied), expected);
  assertEquals(accepted, false);
  assertEquals(String(accepted).includes(supplied), false);
  assertEquals(String(accepted).includes(expected), false);
});
