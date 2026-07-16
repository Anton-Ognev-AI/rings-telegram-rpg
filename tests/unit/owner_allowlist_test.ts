import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  assertOwnerAllowed,
  OwnerAllowlistError,
} from "../../supabase/functions/_shared/telegram/owner-allowlist.ts";
import type { NormalizedTelegramUpdate } from "../../supabase/functions/_shared/telegram/update.ts";

function update(
  telegramExternalId = 900000001n,
  chatId = telegramExternalId,
): NormalizedTelegramUpdate {
  return {
    kind: "command",
    updateId: 700000001n,
    telegramExternalId,
    chatId,
    messageId: 41n,
    command: "start",
    argument: "",
  };
}

Deno.test("owner allowlist accepts one canonical positive private-chat identity", () => {
  assertEquals(assertOwnerAllowed(update(), "900000001"), undefined);
});

Deno.test("owner allowlist rejects malformed configuration without retaining its value", () => {
  for (
    const value of [
      "",
      "0",
      "-1",
      "+1",
      "0900000001",
      "900000001,900000002",
      "900000001-900000002",
      "900000001.0",
      " 900000001 ",
      "9007199254740992",
    ]
  ) {
    const error = assertThrows(
      () => assertOwnerAllowed(update(), value),
      OwnerAllowlistError,
    );
    assertEquals(error.code, "invalid_owner_allowlist");
    assertEquals(error.message, "invalid_owner_allowlist");
  }
});

Deno.test("owner allowlist rejects another actor or any non-private chat generically", () => {
  for (const candidate of [update(900000002n), update(900000001n, -100900000001n)]) {
    const error = assertThrows(
      () => assertOwnerAllowed(candidate, "900000001"),
      OwnerAllowlistError,
    );
    assertEquals(error.code, "owner_not_allowed");
    assertEquals(error.message.includes(candidate.telegramExternalId.toString()), false);
  }
});
