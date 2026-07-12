const SENSITIVE_KEYS = new Set([
  "authorization",
  "secret",
  "telegramActorId",
  "token",
]);

export function redactRecord(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_KEYS.has(key) ? "[REDACTED]" : value,
    ]),
  );
}
