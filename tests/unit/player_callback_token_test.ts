import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1.0.19";
import {
  deriveHeroManagementCallbackToken,
  derivePlayerCallbackToken,
  hashHeroManagementCallbackForActor,
  hashPlayerCallbackForActor,
} from "../../supabase/functions/_shared/telegram/player-callback-token.ts";

const encoder = new TextEncoder();
const key = encoder.encode("0123456789abcdef0123456789abcdef");
const binding = {
  playerId: "10000000-0000-4000-8000-000000000001",
  profileVersion: 3,
  messageId: 700000000000000001n,
  action: { kind: "buy_stat", stat: "agility" },
} as const;

Deno.test("player callback is deterministic, opaque, bounded and actor-verifiable", async () => {
  const first = await derivePlayerCallbackToken(key, binding);
  const replay = await derivePlayerCallbackToken(key, binding);

  assertEquals(first, replay);
  assertMatch(first.raw, /^pa_[A-Za-z0-9_-]+$/);
  assertEquals(encoder.encode(first.raw).byteLength <= 64, true);
  assertMatch(first.tokenSha256, /^[0-9a-f]{64}$/);
  assertMatch(first.contextSha256, /^[0-9a-f]{64}$/);
  for (const forbidden of [binding.playerId, "agility", binding.messageId.toString(), "buy_stat"]) {
    assertEquals(first.raw.includes(forbidden), false);
  }
  assertEquals(await hashPlayerCallbackForActor(first.raw, binding.playerId), {
    tokenSha256: first.tokenSha256,
    contextSha256: first.contextSha256,
  });
});

Deno.test("player callback binds profile version, message, action, actor and key", async () => {
  const baseline = await derivePlayerCallbackToken(key, binding);
  const variants = [
    await derivePlayerCallbackToken(key, { ...binding, profileVersion: 4 }),
    await derivePlayerCallbackToken(key, { ...binding, messageId: 700000000000000002n }),
    await derivePlayerCallbackToken(key, {
      ...binding,
      action: { kind: "buy_stat", stat: "physical" },
    }),
    await derivePlayerCallbackToken(key, {
      ...binding,
      playerId: "10000000-0000-4000-8000-000000000002",
    }),
    await derivePlayerCallbackToken(
      encoder.encode("abcdef0123456789abcdef0123456789"),
      binding,
    ),
  ];
  for (const variant of variants) assertNotEquals(variant.raw, baseline.raw);
});

Deno.test("player callback rejects another namespace and malformed bindings", async () => {
  await Promise.all([
    "cb_abc",
    "del_abc",
    "pa_",
    `pa_${"a".repeat(62)}`,
  ].map(async (raw) => {
    let rejected = false;
    try {
      await hashPlayerCallbackForActor(raw, binding.playerId);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }));
});

Deno.test("hero management callback is isolated, bounded and actor-verifiable", async () => {
  const legacy = await derivePlayerCallbackToken(key, binding);
  const hero = await deriveHeroManagementCallbackToken(key, binding);

  assertMatch(hero.raw, /^hm_[A-Za-z0-9_-]+$/);
  assertEquals(encoder.encode(hero.raw).byteLength <= 64, true);
  assertNotEquals(hero.raw, legacy.raw);
  assertEquals(await hashHeroManagementCallbackForActor(hero.raw, binding.playerId), {
    tokenSha256: hero.tokenSha256,
    contextSha256: hero.contextSha256,
  });
  assertEquals((await derivePlayerCallbackToken(key, binding)).raw, legacy.raw);

  for (
    const [hash, raw] of [
      [hashPlayerCallbackForActor, hero.raw],
      [hashHeroManagementCallbackForActor, legacy.raw],
      [hashHeroManagementCallbackForActor, "hm_"],
      [hashHeroManagementCallbackForActor, `hm_${"a".repeat(62)}`],
    ] as const
  ) {
    let rejected = false;
    try {
      await hash(raw, binding.playerId);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});
