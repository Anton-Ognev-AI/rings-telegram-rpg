import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import type {
  ChoiceCommandV1,
  PartySnapshot,
  RunStateV1,
} from "../../supabase/functions/_shared/contracts/domain.ts";

Deno.test("v1 contracts represent an immutable replay command", () => {
  const command: ChoiceCommandV1 = {
    resolverVersion: "v1",
    stage: 1,
    exchange: null,
    choiceId: "s1-neutral",
  };
  const state: RunStateV1 = {
    stage: 1,
    exchange: null,
    hp: 40,
    bossHp: null,
    xp: 0,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  const party: PartySnapshot = {
    mode: "solo",
    self: {
      maxHp: 40,
      physical: 5,
      magical: 5,
      agility: 5,
      vitality: 5,
      defense: 5,
      vampRateBps: 0,
      postHeal: 0,
    },
    companion: null,
  };
  const content = {
    schemaVersion: "dungeon-v1",
    resolverVersion: "v1",
    id: "case-001-day-01",
    title: "Побічна тривога",
    stages: [],
  } as unknown as DungeonContentV1;

  assertEquals(
    [command.resolverVersion, state.stage, party.mode, content.schemaVersion],
    ["v1", 1, "solo", "dungeon-v1"],
  );
});
