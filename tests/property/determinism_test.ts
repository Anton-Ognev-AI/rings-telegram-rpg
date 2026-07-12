import { assertEquals } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import type {
  ChoiceCommandV1,
  PartySnapshot,
  RunStateV1,
} from "../../supabase/functions/_shared/contracts/domain.ts";
import { resolveAndHash } from "../../supabase/functions/_shared/domain/resolver-registry.ts";

Deno.test("same replay input returns byte-identical resolution and hash 1000 times", async () => {
  const party: PartySnapshot = {
    mode: "solo",
    self: {
      maxHp: 100,
      physical: 70,
      magical: 70,
      agility: 70,
      vitality: 70,
      defense: 0,
      vampRateBps: 0,
      postHeal: 0,
    },
    companion: null,
  };
  const state: RunStateV1 = {
    stage: 1,
    exchange: null,
    hp: 100,
    bossHp: null,
    xp: 0,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  const command: ChoiceCommandV1 = {
    resolverVersion: "v1",
    stage: 1,
    exchange: null,
    choiceId: "s1-agility",
  };
  const input = {
    content: fallback as unknown as DungeonContentV1,
    party,
    state,
    command,
  };
  const first = await resolveAndHash(input);
  for (let iteration = 0; iteration < 1000; iteration++) {
    const replay = await resolveAndHash(input);
    assertEquals(replay.canonical, first.canonical);
    assertEquals(replay.hash, first.hash);
  }
});
