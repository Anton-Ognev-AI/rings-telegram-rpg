import { canonicalJson } from "../domain/canonical-json.ts";

const encoder = new TextEncoder();
const PREFIX = "del_";
const MINIMUM_KEY_BYTES = 32;

export interface DeletionCallbackBinding {
  readonly telegramExternalId: bigint;
  readonly playerId: string;
}

function base64Url(value: Uint8Array): string {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function assertBinding(key: Uint8Array, binding: DeletionCallbackBinding): void {
  if (key.byteLength < MINIMUM_KEY_BYTES) throw new Error("callback_key_too_short");
  if (
    binding.telegramExternalId <= 0n ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      binding.playerId,
    )
  ) throw new Error("invalid_deletion_callback_binding");
}

export async function deriveDeletionCallbackToken(
  key: Uint8Array,
  binding: DeletionCallbackBinding,
): Promise<string> {
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
        playerId: binding.playerId,
        telegramExternalId: binding.telegramExternalId.toString(),
        version: "deletion-confirm-v1",
      })),
    ),
  );
  return PREFIX + base64Url(signature.slice(0, 24));
}

export async function verifyDeletionCallbackToken(
  key: Uint8Array,
  token: string,
  binding: DeletionCallbackBinding,
): Promise<boolean> {
  if (!/^del_[A-Za-z0-9_-]+$/u.test(token) || encoder.encode(token).byteLength > 64) return false;
  let expected: string;
  try {
    expected = await deriveDeletionCallbackToken(key, binding);
  } catch {
    return false;
  }
  const actualBytes = encoder.encode(token);
  const expectedBytes = encoder.encode(expected);
  let difference = actualBytes.length ^ expectedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ (actualBytes[index] ?? 0);
  }
  return difference === 0;
}
