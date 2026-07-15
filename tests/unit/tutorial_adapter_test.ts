import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1.0.19";
import type { ResolutionV1 } from "../../supabase/functions/_shared/contracts/domain.ts";
import { adaptTutorialResolution } from "../../supabase/functions/_shared/progression/tutorial-adapter.ts";

function lethalResolution(overrides: Partial<ResolutionV1> = {}): ResolutionV1 {
  return {
    resolverVersion: "v1",
    stage: 1,
    exchange: null,
    choiceId: "choice-a",
    outcome: "failure",
    clue: { id: "clue-a", text: "Ознака небезпеки" },
    rationale: "Невдалий вибір був смертельним.",
    check: {
      stat: "physical",
      selfPower: 1,
      companionPower: 4,
      totalPower: 5,
      threshold: 10,
    },
    hp: { before: 45, damage: 45, vampHeal: 0, postHeal: 0, after: 0 },
    bossHp: null,
    xp: { before: 0, delta: 0, after: 0 },
    terminal: "defeated",
    nextStage: null,
    nextExchange: null,
    ...overrides,
  };
}

const eligibleContext = {
  tutorialOrdinal: 1 as const,
  rescueUsed: false,
  earlierResultCount: 0,
  maxHp: 45,
};

Deno.test("teacher rescue turns an eligible lethal tutorial choice into a third meaningful chance", () => {
  const resolution = lethalResolution();
  const adapted = adaptTutorialResolution(resolution, eligibleContext);

  assertEquals(adapted, {
    ...resolution,
    hp: { ...resolution.hp, after: 23 },
    terminal: null,
    nextStage: 2,
    nextExchange: null,
    tutorial: { teacherRescue: true, teacherRestore: 23 },
  });
});

Deno.test("teacher rescue is still eligible on the second prepared result", () => {
  const adapted = adaptTutorialResolution(lethalResolution({ stage: 2 }), {
    ...eligibleContext,
    earlierResultCount: 1,
    maxHp: 40,
  });

  assertEquals(adapted.hp.after, 20);
  assertEquals(adapted.nextStage, 3);
  assertEquals(adapted.tutorial, { teacherRescue: true, teacherRestore: 20 });
});

Deno.test("ordinary and ineligible resolutions stay byte-identical by reference", () => {
  const cases = [
    null,
    { ...eligibleContext, tutorialOrdinal: 2 as const },
    { ...eligibleContext, rescueUsed: true },
    { ...eligibleContext, earlierResultCount: 2 },
  ];
  for (const context of cases) {
    const resolution = lethalResolution();
    assertStrictEquals(adaptTutorialResolution(resolution, context), resolution);
  }

  const survived = lethalResolution({
    hp: { before: 45, damage: 44, vampHeal: 0, postHeal: 0, after: 1 },
    terminal: null,
    nextStage: 2,
  });
  assertStrictEquals(adaptTutorialResolution(survived, eligibleContext), survived);

  const contained = lethalResolution({ terminal: "contained" });
  assertStrictEquals(adaptTutorialResolution(contained, eligibleContext), contained);
});

Deno.test("teacher restore never falls below one HP", () => {
  const adapted = adaptTutorialResolution(lethalResolution(), {
    ...eligibleContext,
    maxHp: 1,
  });
  assertEquals(adapted.hp.after, 1);
  assertEquals(adapted.tutorial?.teacherRestore, 1);
});
