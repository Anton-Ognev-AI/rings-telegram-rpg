const HEADER_NAME = "X-TgGame-Internal-Secret";
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 256;

function encodedSecret(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function isAuthorizedInternalRequest(request: Request, configuredSecret: string): boolean {
  const expected = encodedSecret(configuredSecret);
  if (expected.length < MIN_SECRET_BYTES || expected.length > MAX_SECRET_BYTES) {
    throw new Error("invalid_internal_secret_configuration");
  }

  const suppliedValue = request.headers.get(HEADER_NAME);
  if (suppliedValue === null) return false;
  const supplied = encodedSecret(suppliedValue);
  if (supplied.length > MAX_SECRET_BYTES) return false;

  let difference = expected.length ^ supplied.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ (supplied[index] ?? 0);
  }
  return difference === 0;
}
