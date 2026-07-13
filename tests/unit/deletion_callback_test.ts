import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.19";
import {
  deriveDeletionCallbackToken,
  verifyDeletionCallbackToken,
} from "../../supabase/functions/_shared/telegram/deletion-callback.ts";

const key = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const binding = {
  telegramExternalId: 970000000000000001n,
  playerId: "71000000-0000-4000-8000-000000000001",
};

Deno.test("deletion confirmation token is opaque, bounded, and generation-bound", async () => {
  const token = await deriveDeletionCallbackToken(key, binding);
  assertMatch(token, /^del_[A-Za-z0-9_-]+$/u);
  assertEquals(new TextEncoder().encode(token).byteLength <= 64, true);
  assertEquals(token.includes(binding.playerId), false);
  assertEquals(token.includes(binding.telegramExternalId.toString()), false);
  assertEquals(await verifyDeletionCallbackToken(key, token, binding), true);
  assertEquals(
    await verifyDeletionCallbackToken(key, token, {
      ...binding,
      telegramExternalId: binding.telegramExternalId + 1n,
    }),
    false,
  );
  assertEquals(
    await verifyDeletionCallbackToken(key, token, {
      ...binding,
      playerId: "71000000-0000-4000-8000-000000000002",
    }),
    false,
  );
});

Deno.test("deletion confirmation rejects static, malformed, and oversized callbacks", async () => {
  for (const token of ["nav:delete-confirm", "del_", `del_${"a".repeat(65)}`]) {
    assertEquals(await verifyDeletionCallbackToken(key, token, binding), false);
  }
});
