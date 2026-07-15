import { canonicalJson, sha256Hex } from "../domain/canonical-json.ts";
import type { DerivedCallbackToken } from "./callback-token.ts";

const encoder = new TextEncoder();
const PREFIX = "pa_";
const MINIMUM_KEY_BYTES = 32;

export interface PlayerCallbackBinding {
  readonly playerId: string;
  readonly profileVersion: number;
  readonly messageId: bigint;
  readonly action: Readonly<Record<string, unknown>>;
}

function base64Url(value: Uint8Array): string {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function assertBinding(key: Uint8Array, binding: PlayerCallbackBinding): void {
  if (key.byteLength < MINIMUM_KEY_BYTES) throw new Error("callback_key_too_short");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      binding.playerId,
    ) ||
    !Number.isSafeInteger(binding.profileVersion) ||
    binding.profileVersion < 0 ||
    binding.messageId <= 0n ||
    typeof binding.action !== "object" ||
    binding.action === null ||
    Array.isArray(binding.action)
  ) {
    throw new Error("invalid_player_callback_binding");
  }
}

export async function hashPlayerCallbackForActor(
  raw: string,
  playerId: string,
): Promise<Pick<DerivedCallbackToken, "tokenSha256" | "contextSha256">> {
  if (!/^pa_[A-Za-z0-9_-]+$/u.test(raw) || encoder.encode(raw).byteLength > 64) {
    throw new Error("invalid_player_callback_token");
  }
  return {
    tokenSha256: await sha256Hex(raw),
    contextSha256: await sha256Hex(canonicalJson({
      playerId,
      raw,
      version: "player-callback-context-v1",
    })),
  };
}

export async function derivePlayerCallbackToken(
  key: Uint8Array,
  binding: PlayerCallbackBinding,
): Promise<DerivedCallbackToken> {
  assertBinding(key, binding);
  const ownedKey = new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ownedKey.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(canonicalJson({
        ...binding,
        messageId: binding.messageId.toString(),
        version: "player-callback-token-v1",
      })),
    ),
  );
  const raw = PREFIX + base64Url(signature.slice(0, 24));
  return { raw, ...await hashPlayerCallbackForActor(raw, binding.playerId) };
}
