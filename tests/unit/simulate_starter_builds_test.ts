import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import {
  assertNoPairwiseRingDominance,
  baselineRingDominancePairs,
  pairwiseDominancePairs,
  scoreInformedCheckChoice,
  selectInformedChoice,
  selectSurvivalAwareChoice,
  simulateStarterBuildMatrix,
  simulateStarterBuildMatrixForContent,
  simulateSurvivalAwareStarterMatrix,
} from "../../scripts/simulate-starter-builds.ts";
import type {
  ChoiceV1,
  DungeonContentV1,
} from "../../supabase/functions/_shared/contracts/content.ts";
import type {
  PartySnapshot,
  RunStateV1,
} from "../../supabase/functions/_shared/contracts/domain.ts";
import { resolveChoiceV1 } from "../../supabase/functions/_shared/domain/resolvers/v1/resolver.ts";

const fallback = fallbackJson as DungeonContentV1;

function fireParty(): PartySnapshot {
  return {
    mode: "solo",
    self: {
      maxHp: 40,
      physical: 5,
      magical: 9,
      agility: 5,
      vitality: 5,
      defense: 7,
      vampRateBps: 0,
      postHeal: 0,
    },
    companion: null,
  };
}

function stageThreeChoices(): readonly ChoiceV1[] {
  const choices = fallback.stages[2]?.choices;
  if (!choices) throw new Error("missing_stage_three_choices");
  return choices;
}

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
  assertEquals(baselinePairs, []);
  assertThrows(
    () => baselineRingDominancePairs(reports.slice(1)),
    Error,
    "incomplete_starter_balance_matrix",
  );
});

Deno.test("policy correction alone preserves the exact old fallback balance debt", async () => {
  const unpatched: DungeonContentV1 = {
    ...structuredClone(fallback),
    stages: fallback.stages.map((stage) =>
      stage.number === 3
        ? {
          ...structuredClone(stage),
          choices: stage.choices?.map((choice) =>
            choice.id === "s3-magical"
              ? { ...choice, tacticalModifier: "standard" as const }
              : { ...choice }
          ),
        }
        : structuredClone(stage)
    ),
  };

  const reports = await simulateStarterBuildMatrixForContent(unpatched);
  assertEquals(pairwiseDominancePairs(reports), []);
  assertEquals(baselineRingDominancePairs(reports), [
    { dominant: "weapon", dominated: "fire" },
    { dominant: "defense", dominated: "fire" },
    { dominant: "healing", dominated: "fire" },
  ]);
});

Deno.test("informed choice score has parity with the resolver threshold", () => {
  const magical = stageThreeChoices().find((choice) => choice.id === "s3-magical");
  if (!magical) throw new Error("missing_s3_magical_check");
  const party = fireParty();
  const state: RunStateV1 = {
    stage: 3,
    exchange: null,
    hp: 40,
    bossHp: null,
    xp: 0,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  const resolution = resolveChoiceV1({
    content: fallback,
    party,
    state,
    command: { resolverVersion: "v1", stage: 3, exchange: null, choiceId: magical.id },
  });
  if (!resolution.check) throw new Error("missing_resolver_check");
  assertEquals(
    scoreInformedCheckChoice(magical, party, 3),
    resolution.check.totalPower - resolution.check.threshold,
  );
});

Deno.test("informed and mixed-alternative choices are build-aware with stable array ties", () => {
  const choices = stageThreeChoices();
  const best = selectInformedChoice(choices, fireParty(), 3);
  assertEquals(best.id, "s3-magical");
  assertEquals(selectInformedChoice(choices, fireParty(), 3, best.id).id, "s3-physical");

  const physical = choices.find((choice) => choice.id === "s3-physical");
  if (!physical || physical.kind !== "check") throw new Error("missing_s3_physical_check");
  const first = { ...physical, id: "z-first" };
  const second = { ...physical, id: "a-second" };
  assertEquals(selectInformedChoice([first, second], fireParty(), 3).id, "z-first");
  assertEquals(selectInformedChoice([second, first], fireParty(), 3).id, "a-second");
});

Deno.test("survival-aware policy takes a passing check and falls back to neutral when all fail", () => {
  const stageThree = stageThreeChoices();
  assertEquals(selectSurvivalAwareChoice(stageThree, fireParty(), 3).id, "s3-magical");

  const stageNine = fallback.stages[8]?.choices;
  if (!stageNine) throw new Error("missing_stage_nine_choices");
  const neutral = stageNine.find((choice) => choice.kind === "neutral");
  if (!neutral) throw new Error("missing_stage_nine_neutral");
  const weakParty: PartySnapshot = {
    mode: "solo",
    self: {
      maxHp: 40,
      physical: 0,
      magical: 0,
      agility: 0,
      vitality: 0,
      defense: 0,
      vampRateBps: 0,
      postHeal: 0,
    },
    companion: null,
  };
  assertEquals(selectSurvivalAwareChoice(stageNine, weakParty, 9).id, neutral.id);
});

Deno.test("survival-aware diagnostic covers 24 contexts and dominates all-neutral play", async () => {
  const adaptive = await simulateSurvivalAwareStarterMatrix();
  const repeated = await simulateSurvivalAwareStarterMatrix();
  assertEquals(adaptive, repeated);
  assertEquals(adaptive.length, 24);
  assertEquals(new Set(adaptive.map((report) => report.policy)), new Set(["survival_aware"]));
  assertEquals(adaptive.every((report) => report.terminal !== null), true);

  const attrition = (await simulateStarterBuildMatrix()).filter((report) =>
    report.policy === "attrition"
  );
  const byContext = new Map(attrition.map((report) => [
    `${report.archetype}:${report.partyMode}:${report.ring}`,
    report,
  ]));
  let xpImprovement = 0;
  for (const report of adaptive) {
    const comparison = byContext.get(`${report.archetype}:${report.partyMode}:${report.ring}`);
    if (!comparison) throw new Error("missing_attrition_comparison");
    assertEquals(report.lastCompletedStage >= comparison.lastCompletedStage, true);
    assertEquals(report.xp >= comparison.xp, true);
    if (report.xp > comparison.xp) xpImprovement += 1;
  }
  assertEquals(xpImprovement > 0, true);
});
