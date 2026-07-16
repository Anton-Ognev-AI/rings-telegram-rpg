import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  assertNoPairwiseRingDominance,
  baselineRingDominancePairs,
  pairwiseDominancePairs,
  simulateStarterBuildMatrix,
} from "../../scripts/simulate-starter-builds.ts";

Deno.test("starter balance matrix covers 72 unique terminal archetype contexts", async () => {
  const first = await simulateStarterBuildMatrix();
  const second = await simulateStarterBuildMatrix();
  assertEquals(first, second);
  assertEquals(first.length, 72);
  assertEquals(
    new Set(first.map((report) => report.ring)),
    new Set(["weapon", "fire", "defense", "healing"]),
  );
  assertEquals(
    new Set(first.map((report) => report.policy)),
    new Set(["correct", "mixed", "attrition"]),
  );
  assertEquals(new Set(first.map((report) => report.partyMode)), new Set(["tutorial", "ordinary"]));
  assertEquals(
    new Set(first.map((report) => report.archetype)),
    new Set(["baseline", "martial", "arcane"]),
  );
  assertEquals(first.every((report) => report.terminal !== null), true);
  assertEquals(
    new Set(
      first.map((report) =>
        `${report.archetype}:${report.partyMode}:${report.policy}:${report.ring}`
      ),
    ).size,
    72,
  );
  assertEquals(first.every((report) => /^[0-9a-f]{64}$/u.test(report.replayHash)), true);
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

Deno.test("pairwise gate reports the exact dominant and dominated ring", async () => {
  const reports = (await simulateStarterBuildMatrix()).map((report) =>
    report.ring === "weapon"
      ? {
        ...report,
        lastCompletedStage: 10,
        terminal: "victory" as const,
        remainingHp: 99,
        xp: 999,
        successfulChecks: { physical: 99, magical: 99, agility: 99, vitality: 99 },
      }
      : report.ring === "fire"
      ? {
        ...report,
        lastCompletedStage: 1,
        terminal: "defeated" as const,
        remainingHp: 0,
        xp: 0,
        successfulChecks: { physical: 0, magical: 0, agility: 0, vitality: 0 },
      }
      : report
  );
  assertEquals(
    pairwiseDominancePairs(reports).some((pair) =>
      pair.dominant === "weapon" && pair.dominated === "fire"
    ),
    true,
  );
  assertThrows(
    () => assertNoPairwiseRingDominance(reports),
    Error,
    "pairwise_starter_ring_dominance:weapon>fire",
  );
});

Deno.test("pairwise gate rejects missing, duplicate, or active matrix rows", async () => {
  const reports = await simulateStarterBuildMatrix();
  assertThrows(
    () => pairwiseDominancePairs(reports.slice(1)),
    Error,
    "incomplete_starter_balance_matrix",
  );
  assertThrows(
    () => pairwiseDominancePairs([reports[1]!, ...reports.slice(1)]),
    Error,
    "incomplete_starter_balance_matrix",
  );
  assertThrows(
    () =>
      pairwiseDominancePairs([
        { ...reports[0]!, terminal: null },
        ...reports.slice(1),
      ]),
    Error,
    "incomplete_starter_balance_matrix",
  );
  const unknownArchetype = {
    ...reports[0]!,
    archetype: "unknown",
  } as unknown as (typeof reports)[number];
  assertThrows(
    () => pairwiseDominancePairs([unknownArchetype, ...reports.slice(1)]),
    Error,
    "incomplete_starter_balance_matrix",
  );
});

Deno.test("actual starter diagnostics separate the full gate from baseline evidence", async () => {
  const reports = await simulateStarterBuildMatrix();
  assertEquals(pairwiseDominancePairs(reports), []);
  const baselinePairs = baselineRingDominancePairs(reports);
  assertEquals(baselinePairs, [
    { dominant: "weapon", dominated: "fire" },
    { dominant: "defense", dominated: "fire" },
    { dominant: "healing", dominated: "fire" },
  ]);
  assertThrows(
    () => baselineRingDominancePairs(reports.slice(1)),
    Error,
    "incomplete_starter_balance_matrix",
  );
});
