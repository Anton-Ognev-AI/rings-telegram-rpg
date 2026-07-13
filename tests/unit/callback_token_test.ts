import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1.0.19";
import {
  deriveCallbackToken,
  hashCallbackForActor,
} from "../../supabase/functions/_shared/telegram/callback-token.ts";

const encoder = new TextEncoder();
const key = encoder.encode("0123456789abcdef0123456789abcdef");
const binding = {
  playerId: "10000000-0000-4000-8000-000000000001",
  runId: "20000000-0000-4000-8000-000000000001",
  stateVersion: 7,
  stage: 4,
  exchange: null,
  choiceId: "s4-agility",
} as const;

Deno.test("callback token is deterministic, opaque, bounded, and actor-verifiable", async () => {
  const first = await deriveCallbackToken(key, binding);
  const second = await deriveCallbackToken(key, binding);
  assertEquals(first, second);
  assertEquals(encoder.encode(first.raw).byteLength <= 64, true);
  assertMatch(first.raw, /^cb_[A-Za-z0-9_-]+$/);
  assertMatch(first.tokenSha256, /^[0-9a-f]{64}$/);
  assertMatch(first.contextSha256, /^[0-9a-f]{64}$/);
  for (const forbidden of [binding.playerId, binding.runId, binding.choiceId, "s4", "agility"]) {
    assertEquals(first.raw.includes(forbidden), false);
  }

  assertEquals(await hashCallbackForActor(first.raw, binding.playerId), {
    tokenSha256: first.tokenSha256,
    contextSha256: first.contextSha256,
  });
});

Deno.test("callback token changes with key, state, exchange, or choice", async () => {
  const baseline = await deriveCallbackToken(key, binding);
  const variants = [
    await deriveCallbackToken(encoder.encode("abcdef0123456789abcdef0123456789"), binding),
    await deriveCallbackToken(key, { ...binding, stateVersion: 8 }),
    await deriveCallbackToken(key, { ...binding, stage: 10, exchange: 1 }),
    await deriveCallbackToken(key, { ...binding, choiceId: "s4-neutral" }),
  ];
  for (const variant of variants) assertNotEquals(variant.raw, baseline.raw);
});
