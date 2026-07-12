import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  assertLocalDatabaseUrl,
  PRIMARY_TEST_DATABASE_URL,
  redactDatabaseError,
} from "../../scripts/db/local-database.ts";

Deno.test("database guard accepts the synthetic loopback database", () => {
  const parsed = assertLocalDatabaseUrl(PRIMARY_TEST_DATABASE_URL);

  assertEquals(parsed.hostname, "127.0.0.1");
  assertEquals(parsed.port, "54322");
});

Deno.test("database guard accepts IPv4 and IPv6 loopback only by default", () => {
  assertEquals(
    assertLocalDatabaseUrl("postgresql://postgres:postgres@localhost:54322/postgres").hostname,
    "localhost",
  );
  assertEquals(
    assertLocalDatabaseUrl("postgresql://postgres:postgres@[::1]:54322/postgres").hostname,
    "[::1]",
  );
  assertThrows(
    () => assertLocalDatabaseUrl("postgresql://postgres:postgres@db.example.com/postgres"),
    Error,
    "refusing non-loopback",
  );
});

Deno.test("database guard rejects malformed and non-Postgres URLs", () => {
  assertThrows(() => assertLocalDatabaseUrl("not-a-url"), TypeError);
  assertThrows(
    () => assertLocalDatabaseUrl("https://127.0.0.1:54322/postgres"),
    Error,
    "Postgres URL",
  );
});

Deno.test("database guard requires an explicit override for a remote host", () => {
  const parsed = assertLocalDatabaseUrl(
    "postgresql://postgres:secret@db.example.com/postgres",
    true,
  );

  assertEquals(parsed.hostname, "db.example.com");
});

Deno.test("database errors never expose connection passwords", () => {
  const url = "postgresql://postgres:top-secret@127.0.0.1:54322/postgres";
  const redacted = redactDatabaseError(new Error(`connection failed for ${url}: top-secret`), url);

  assertEquals(redacted.message.includes("top-secret"), false);
  assertEquals(redacted.message.includes("[REDACTED]"), true);
});
