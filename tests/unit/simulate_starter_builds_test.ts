import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import {
  assertNoStrictRingDominance,
  simulateStarterBuildMatrix,
} from "../../scripts/simulate-starter-builds.ts";

Deno.test("starter balance matrix covers four rings, three policies and two party modes", async () => {
  const first = await simulateStarterBuildMatrix();
  const second = await simulateStarterBuildMatrix();
  assertEquals(first, second);
  assertEquals(first.length, 24);
  assertEquals(
    new Set(first.map((report) => report.ring)),
    new Set(["weapon", "fire", "defense", "healing"]),
  );
  assertEquals(
    new Set(first.map((report) => report.policy)),
    new Set(["correct", "mixed", "attrition"]),
  );
  assertEquals(new Set(first.map((report) => report.partyMode)), new Set(["tutorial", "ordinary"]));
  assertEquals(first.every((report) => /^[0-9a-f]{64}$/u.test(report.replayHash)), true);
  assertNoStrictRingDominance(first);
});

Deno.test("starter rings produce distinct survival or successful-check evidence", async () => {
  const reports = await simulateStarterBuildMatrix();
  const ordinaryCorrect = reports.filter((report) =>
    report.partyMode === "ordinary" && report.policy === "correct"
  );
  const signatures = ordinaryCorrect.map((report) =>
    JSON.stringify({
      depth: report.lastCompletedStage,
      terminal: report.terminal,
      hp: report.remainingHp,
      xp: report.xp,
      successfulChecks: report.successfulChecks,
    })
  );
  assertNotEquals(new Set(signatures).size, 1);
  const healing = ordinaryCorrect.find((report) => report.ring === "healing");
  const weapon = ordinaryCorrect.find((report) => report.ring === "weapon");
  if (!healing || !weapon) throw new Error("missing_ring_report");
  assertNotEquals(
    { hp: healing.remainingHp, checks: healing.successfulChecks },
    { hp: weapon.remainingHp, checks: weapon.successfulChecks },
  );
});
