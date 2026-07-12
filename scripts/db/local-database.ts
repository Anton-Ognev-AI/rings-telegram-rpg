import postgres, { type Sql } from "npm:postgres@3.4.7";

export const PRIMARY_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertLocalDatabaseUrl(value: string, allowRemote = false): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("expected a Postgres URL");
  }
  if (!allowRemote && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`refusing non-loopback database host: ${parsed.hostname}`);
  }
  return parsed;
}

export function redactDatabaseError(error: unknown, databaseUrl: string): Error {
  const parsed = new URL(databaseUrl);
  let message = error instanceof Error ? error.message : String(error);
  message = message.replaceAll(databaseUrl, "[REDACTED DATABASE URL]");
  const encodedPassword = parsed.password;
  const decodedPassword = encodedPassword ? decodeURIComponent(encodedPassword) : "";
  for (const secret of new Set([encodedPassword, decodedPassword])) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  return new Error(message);
}

export async function withDatabase<T>(
  work: (sql: Sql) => Promise<T>,
  databaseUrl = Deno.env.get("TEST_DATABASE_URL") ?? PRIMARY_TEST_DATABASE_URL,
): Promise<T> {
  assertLocalDatabaseUrl(databaseUrl, Deno.env.get("ALLOW_REMOTE_TEST_DB") === "1");
  const sql = postgres(databaseUrl, { max: 10 });
  try {
    return await work(sql);
  } catch (error) {
    throw redactDatabaseError(error, databaseUrl);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
