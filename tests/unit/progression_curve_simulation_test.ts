import { assertEquals, assertGreater } from "jsr:@std/assert@1.0.19";
import {
  BASELINE_V1_CURVES,
  CANDIDATE_V2_CURVES,
  candidateMaxHp,
  cumulativeStatCost,
  deepestPassingStage,
  projectedStatCost,
  prototypeMaxHp,
  simulateAttritionDepth,
  stageCurve,
} from "../../scripts/simulate-progression-curves.ts";

Deno.test("HP candidate represents vitality directly without changing the prototype", () => {
  assertEquals(prototypeMaxHp(5), 40);
  assertEquals(prototypeMaxHp(6), 44);
  assertEquals(candidateMaxHp(5), 50);
  assertEquals(candidateMaxHp(6), 60);
});

Deno.test("mild geometric stat cost preserves early agency and moves weight to late growth", () => {
  assertEquals(
    Array.from({ length: 10 }, (_, purchased) => projectedStatCost(CANDIDATE_V2_CURVES, purchased)),
    [20, 24, 29, 35, 42, 50, 60, 72, 86, 104],
  );
  assertEquals(cumulativeStatCost(CANDIDATE_V2_CURVES, 30), 23_648);
  assertGreater(
    cumulativeStatCost(CANDIDATE_V2_CURVES, 30),
    cumulativeStatCost(BASELINE_V1_CURVES, 30),
  );
  assertGreater(
    projectedStatCost(CANDIDATE_V2_CURVES, 0) +
      projectedStatCost(CANDIDATE_V2_CURVES, 1),
    43,
  );
  assertEquals(projectedStatCost(CANDIDATE_V2_CURVES, 0) * 2 <= 43, true);
});

Deno.test("candidate depth keeps four fitting stages accessible and makes stage six earned", () => {
  assertEquals(stageCurve(CANDIDATE_V2_CURVES, "threshold", 10), [
    5,
    7,
    10,
    13,
    17,
    23,
    31,
    41,
    56,
    75,
  ]);
  assertEquals(deepestPassingStage(CANDIDATE_V2_CURVES, 13, -3, 20), 4);
  assertEquals(deepestPassingStage(CANDIDATE_V2_CURVES, 25, -3, 20), 6);
});

Deno.test("HP times ten alone worsens overreach but the coupled candidate restores depth", () => {
  const hpWithTeacher = candidateMaxHp(5) + 5;
  const hpOnly = simulateAttritionDepth(BASELINE_V1_CURVES, {
    hp: hpWithTeacher,
    defense: 6,
    outcome: "neutral",
    maxStages: 9,
  });
  const coupledNeutral = simulateAttritionDepth(CANDIDATE_V2_CURVES, {
    hp: hpWithTeacher,
    defense: 6,
    outcome: "neutral",
    maxStages: 20,
  });
  const coupledFailure = simulateAttritionDepth(CANDIDATE_V2_CURVES, {
    hp: hpWithTeacher,
    defense: 6,
    outcome: "failure",
    maxStages: 20,
  });

  assertEquals(hpOnly.lastCompletedStage, 9);
  assertEquals(coupledNeutral.lastCompletedStage, 5);
  assertEquals(coupledFailure.lastCompletedStage, 4);
});
