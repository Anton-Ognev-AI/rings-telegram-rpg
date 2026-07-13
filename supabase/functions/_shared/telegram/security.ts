const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const MAX_SECRET_BYTES = 256;
const encoder = new TextEncoder();

function isBoundedSecret(value: string): boolean {
  const size = encoder.encode(value).byteLength;
  return size >= 1 && size <= MAX_SECRET_BYTES;
}

function constantTimeEquals(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function verifyTelegramSecret(request: Request, expected: string): Promise<boolean> {
  const supplied = request.headers.get(SECRET_HEADER);
  if (supplied === null || !isBoundedSecret(supplied) || !isBoundedSecret(expected)) return false;
  const [suppliedDigest, expectedDigest] = await Promise.all([digest(supplied), digest(expected)]);
  return constantTimeEquals(suppliedDigest, expectedDigest);
}
