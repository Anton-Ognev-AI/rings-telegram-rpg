import { assertEquals } from "jsr:@std/assert@1.0.19";
import { getCycleWindow, zonedLocalToUtc } from "../../supabase/functions/_shared/domain/cycle.ts";

Deno.test("Kyiv cycle opens at local 09:00 in winter", () => {
  const window = getCycleWindow(new Date("2026-01-15T07:30:00Z"));
  assertEquals(window.cycleId, "2026-01-15");
  assertEquals(window.opensAt.toISOString(), "2026-01-15T07:00:00.000Z");
  assertEquals(window.closesAt.toISOString(), "2026-01-16T07:00:00.000Z");
  assertEquals(window.graceEndsAt.toISOString(), "2026-01-16T09:00:00.000Z");
});

Deno.test("Kyiv cycle opens at local 09:00 in summer", () => {
  const window = getCycleWindow(new Date("2026-07-15T06:30:00Z"));
  assertEquals(window.cycleId, "2026-07-15");
  assertEquals(window.opensAt.toISOString(), "2026-07-15T06:00:00.000Z");
  assertEquals(window.closesAt.toISOString(), "2026-07-16T06:00:00.000Z");
});

Deno.test("instant before local 09:00 belongs to previous cycle", () => {
  const window = getCycleWindow(new Date("2026-07-15T05:59:59Z"));
  assertEquals(window.cycleId, "2026-07-14");
  assertEquals(window.opensAt.toISOString(), "2026-07-14T06:00:00.000Z");
});

Deno.test("spring DST cycle spans 23 UTC hours between local 09:00 boundaries", () => {
  const window = getCycleWindow(new Date("2026-03-28T08:00:00Z"));
  assertEquals(window.cycleId, "2026-03-28");
  assertEquals(window.opensAt.toISOString(), "2026-03-28T07:00:00.000Z");
  assertEquals(window.closesAt.toISOString(), "2026-03-29T06:00:00.000Z");
  assertEquals(window.closesAt.getTime() - window.opensAt.getTime(), 23 * 60 * 60 * 1000);
});

Deno.test("autumn DST cycle spans 25 UTC hours between local 09:00 boundaries", () => {
  const window = getCycleWindow(new Date("2026-10-24T07:00:00Z"));
  assertEquals(window.cycleId, "2026-10-24");
  assertEquals(window.opensAt.toISOString(), "2026-10-24T06:00:00.000Z");
  assertEquals(window.closesAt.toISOString(), "2026-10-25T07:00:00.000Z");
  assertEquals(window.closesAt.getTime() - window.opensAt.getTime(), 25 * 60 * 60 * 1000);
});

Deno.test("zoned conversion does not assume one Kyiv offset", () => {
  assertEquals(
    zonedLocalToUtc({ year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 }, "Europe/Kyiv")
      .toISOString(),
    "2026-01-15T07:00:00.000Z",
  );
  assertEquals(
    zonedLocalToUtc({ year: 2026, month: 7, day: 15, hour: 9, minute: 0, second: 0 }, "Europe/Kyiv")
      .toISOString(),
    "2026-07-15T06:00:00.000Z",
  );
});
