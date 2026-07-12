import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.19";
import {
  DEVELOPED_SOLO_BUILD,
  EARLY_TEACHER_BUILD,
  simulateBuild,
} from "../../scripts/simulate-balance.ts";

Deno.test("early tutorial build stops around the stage-5 boundary", async () => {
  const early = await simulateBuild(EARLY_TEACHER_BUILD, "recommended-checks");
  assertEquals(early.lastCompletedStage >= 4 && early.lastCompletedStage <= 6, true);
  assertEquals(early.terminal, "defeated");
  assertEquals(early.xp <= 150, true);
  assertMatch(early.replayHash, /^[0-9a-f]{64}$/);
});

Deno.test("developed solo build can legally win stage 10", async () => {
  const developed = await simulateBuild(DEVELOPED_SOLO_BUILD, "recommended-checks");
  assertEquals(developed.terminal, "victory");
  assertEquals(developed.lastCompletedStage, 10);
  assertEquals(developed.xp, 150);
  assertMatch(developed.replayHash, /^[0-9a-f]{64}$/);
});

Deno.test("balance simulation report is deterministic", async () => {
  const first = await simulateBuild(DEVELOPED_SOLO_BUILD, "recommended-checks");
  const second = await simulateBuild(DEVELOPED_SOLO_BUILD, "recommended-checks");
  assertEquals(first, second);
});
