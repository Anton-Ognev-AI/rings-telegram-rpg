import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { assertPgTapResults } from "../../scripts/db/run-pgtap.ts";

Deno.test("pgTAP runner accepts a complete passing plan", () => {
  assertEquals(
    assertPgTapResults([[{ plan: "1..2" }], [{ result: "ok 1 - first" }], [
      { result: "ok 2 - second" },
    ]]),
    2,
  );
});

Deno.test("pgTAP runner rejects a failed assertion", () => {
  assertThrows(
    () =>
      assertPgTapResults([[{ plan: "1..1" }], [{ result: "not ok 1 - denied" }], [
        { finish: "# Looks like you failed 1 test of 1" },
      ]]),
    Error,
    "not ok 1",
  );
});

Deno.test("pgTAP runner rejects an incomplete plan", () => {
  assertThrows(
    () => assertPgTapResults([[{ plan: "1..2" }], [{ result: "ok 1 - only one" }]]),
    Error,
    "expected 2 assertions but received 1",
  );
});
