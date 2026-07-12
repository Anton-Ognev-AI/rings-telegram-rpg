import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import {
  assertDungeonContentV1,
  validateDungeonContentV1,
} from "../../supabase/functions/_shared/domain/content-validator.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";

type DeepMutable<T> = T extends readonly (infer U)[] ? DeepMutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T;
type MutableContent = DeepMutable<DungeonContentV1>;

function clone(): MutableContent {
  return structuredClone(fallback) as unknown as MutableContent;
}

function expectInvalid(
  name: string,
  mutate: (content: MutableContent) => void,
  expected: string,
): void {
  Deno.test(`dungeon validator rejects ${name}`, () => {
    const content = clone();
    mutate(content);
    const result = validateDungeonContentV1(content);
    assertEquals(result.ok, false);
    if (!result.ok) assertStringIncludes(result.errors.join(" | "), expected);
  });
}

Deno.test("fallback dungeon satisfies v1 shape and quotas", () => {
  assertEquals(validateDungeonContentV1(fallback), { ok: true });
  assertDungeonContentV1(fallback);
});

expectInvalid("nine stages", (x) => x.stages.pop(), "stages must contain exactly 10 entries");
expectInvalid(
  "missing neutral",
  (x) => x.stages[2].choices = x.stages[2].choices!.filter((choice) => choice.kind !== "neutral"),
  "stage 3 must contain a neutral choice",
);
expectInvalid(
  "an early trap",
  (x) => x.stages[0].choices![0].kind = "trap",
  "trap is forbidden on stages 1-2",
);
expectInvalid(
  "one boss exchange",
  (x) => x.stages[9].bossExchanges!.pop(),
  "stage 10 must contain exactly 2 boss exchanges",
);
expectInvalid(
  "adjacent encounter types",
  (x) => x.stages[1].encounterType = "exploration",
  "adjacent stages must differ",
);
expectInvalid(
  "four combat stages",
  (x) => x.stages[6].encounterType = "combat",
  "dungeon may contain at most 3 combat stages",
);
expectInvalid(
  "no research stage",
  (x) => {
    x.stages[1].encounterType = "hazard";
    x.stages[8].encounterType = "exploration";
  },
  "dungeon must contain a research stage",
);
expectInvalid(
  "no social stage",
  (x) => {
    x.stages[5].encounterType = "exploration";
    x.stages[7].encounterType = "hazard";
  },
  "dungeon must contain a social stage",
);
expectInvalid(
  "three important choices",
  (x) => x.stages[5].important = true,
  "dungeon may contain at most 2 important choices",
);
expectInvalid(
  "two traps",
  (x) => x.stages[6].choices![0].kind = "trap",
  "dungeon may contain at most 1 trap",
);
expectInvalid(
  "duplicate choice IDs",
  (x) => x.stages[1].choices![0].id = x.stages[0].choices![0].id,
  "choice IDs must be unique",
);
expectInvalid(
  "a missing clue reference",
  (x) => x.stages[2].choices![0].clueId = "absent",
  "references unknown clue",
);
expectInvalid(
  "scene text over 700 characters",
  (x) => x.stages[0].scene = "а".repeat(701),
  "scene must be at most 700 characters",
);
expectInvalid(
  "fewer than two choices",
  (x) => x.stages[0].choices = [x.stages[0].choices![0]],
  "must contain 2-4 choices",
);
expectInvalid(
  "boss fields on an ordinary stage",
  (x) => x.stages[0].bossExchanges = [],
  "stages 1-9 cannot contain bossExchanges",
);
expectInvalid(
  "ordinary choices on the boss",
  (x) => x.stages[9].choices = [],
  "stage 10 cannot contain ordinary choices",
);
expectInvalid(
  "a numeric threshold in content",
  (x) => (x.stages[0].choices![0] as unknown as Record<string, unknown>).threshold = 99,
  "stage 1 choice has unexpected field threshold",
);
expectInvalid(
  "fewer than two check routes",
  (x) => x.stages[0].choices![1].kind = "neutral",
  "stage 1 must contain at least 2 check choices",
);
