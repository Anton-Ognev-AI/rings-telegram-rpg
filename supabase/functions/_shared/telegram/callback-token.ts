import { canonicalJson, sha256Hex } from "../domain/canonical-json.ts";

const encoder = new TextEncoder();
const CALLBACK_PREFIX = "cb_";
const MINIMUM_KEY_BYTES = 32;

export interface CallbackBinding {
  readonly playerId: string;
  readonly runId: string;
  readonly stateVersion: number;
  readonly stage: number;
  readonly exchange: 1 | 2 | null;
  readonly choiceId: string;
}

export interface DerivedCallbackToken {
  readonly raw: string;
  readonly tokenSha256: string;
  readonly contextSha256: string;
}

function base64Url(value: Uint8Array): string {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function assertCallbackKey(key: Uint8Array): void {
  if (key.byteLength < MINIMUM_KEY_BYTES) throw new Error("callback_key_too_short");
}

export async function hashCallbackForActor(
  raw: string,
  playerId: string,
): Promise<Pick<DerivedCallbackToken, "tokenSha256" | "contextSha256">> {
  if (!/^cb_[A-Za-z0-9_-]+$/u.test(raw) || encoder.encode(raw).byteLength > 64) {
    throw new Error("invalid_callback_token");
  }
  return {
    tokenSha256: await sha256Hex(raw),
    contextSha256: await sha256Hex(canonicalJson({
      playerId,
      raw,
      version: "callback-context-v1",
    })),
  };
}

export async function deriveCallbackToken(
  key: Uint8Array,
  binding: CallbackBinding,
): Promise<DerivedCallbackToken> {
  assertCallbackKey(key);
  const ownedKey = new Uint8Array(key.byteLength);
  ownedKey.set(key);
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
      encoder.encode(canonicalJson({ ...binding, version: "callback-token-v1" })),
    ),
  );
  const raw = CALLBACK_PREFIX + base64Url(signature.slice(0, 24));
  return { raw, ...await hashCallbackForActor(raw, binding.playerId) };
}
