import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  formatChecksumManifest,
  verifyChecksumManifest,
} from "../../scripts/db/migration-checksums.ts";

Deno.test("migration checksum manifest is ordered and newline terminated", () => {
  const manifest = formatChecksumManifest([
    { file: "202607120002_config.sql", sha256: "b".repeat(64) },
    { file: "202607120001_foundation.sql", sha256: "a".repeat(64) },
  ]);

  assertEquals(
    manifest,
    `${"a".repeat(64)}  202607120001_foundation.sql\n${"b".repeat(64)}  202607120002_config.sql\n`,
  );
});

Deno.test("migration checksum verification rejects byte drift", () => {
  let message = "";
  try {
    verifyChecksumManifest("canonical\n", "mutated\n");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "migration checksum drift detected");
});
