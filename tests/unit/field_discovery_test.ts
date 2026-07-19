import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  fieldDiscoveryChance,
  planTutorialFieldDiscovery,
} from "../../supabase/functions/_shared/progression/field-discovery.ts";

const runId = "20000000-0000-4000-8000-000000000001";

Deno.test("tutorial field discovery uses the protected outcome chance table", () => {
  assertEquals(fieldDiscoveryChance(1, "success"), 30);
  assertEquals(fieldDiscoveryChance(1, "neutral"), 20);
  assertEquals(fieldDiscoveryChance(1, "failure"), 10);
  assertEquals(fieldDiscoveryChance(2, "success"), 65);
  assertEquals(fieldDiscoveryChance(2, "neutral"), 50);
  assertEquals(fieldDiscoveryChance(2, "failure"), 30);
  assertEquals(fieldDiscoveryChance(3, "success"), 100);
  assertEquals(fieldDiscoveryChance(3, "neutral"), 100);
  assertEquals(fieldDiscoveryChance(3, "failure"), 100);
  assertEquals(fieldDiscoveryChance(4, "success"), 0);
});

Deno.test("tutorial discovery roll and empty-slot choice are deterministic", async () => {
  const input = {
    runId,
    tutorialOrdinal: 1 as const,
    resolvedStage: 1,
    outcome: "success" as const,
    terminal: false,
    hasHistoricalDiscovery: false,
    hasPendingOffer: false,
    occupiedSupportSlots: [] as const,
  };
  const first = await planTutorialFieldDiscovery(input);
  const replay = await planTutorialFieldDiscovery(input);

  assertEquals(first, replay);
  assertEquals(first, {
    eligible: true,
    chancePercent: 30,
    roll: 4,
    shouldOffer: true,
    slot: "talisman",
  });
});

Deno.test("stage three is a pity boundary and occupied support slots are never selected", async () => {
  const armorOnly = await planTutorialFieldDiscovery({
    runId,
    tutorialOrdinal: 1,
    resolvedStage: 3,
    outcome: "failure",
    terminal: false,
    hasHistoricalDiscovery: false,
    hasPendingOffer: false,
    occupiedSupportSlots: ["armor"],
  });
  assertEquals(armorOnly.chancePercent, 100);
  assertEquals(armorOnly.shouldOffer, true);
  assertEquals(armorOnly.slot, "talisman");

  const talismanOnly = await planTutorialFieldDiscovery({
    runId,
    tutorialOrdinal: 1,
    resolvedStage: 3,
    outcome: "neutral",
    terminal: false,
    hasHistoricalDiscovery: false,
    hasPendingOffer: false,
    occupiedSupportSlots: ["talisman"],
  });
  assertEquals(talismanOnly.shouldOffer, true);
  assertEquals(talismanOnly.slot, "armor");
});

Deno.test("ineligible discovery contexts fail closed", async () => {
  const base = {
    runId,
    tutorialOrdinal: 1 as 1 | 2 | null,
    resolvedStage: 2,
    outcome: "success" as const,
    terminal: false,
    hasHistoricalDiscovery: false,
    hasPendingOffer: false,
    occupiedSupportSlots: [] as readonly ("armor" | "talisman")[],
  };
  const cases = [
    { ...base, tutorialOrdinal: null },
    { ...base, tutorialOrdinal: 2 as const },
    { ...base, terminal: true },
    { ...base, hasHistoricalDiscovery: true },
    { ...base, hasPendingOffer: true },
    { ...base, resolvedStage: 4 },
    { ...base, occupiedSupportSlots: ["armor", "talisman"] as const },
  ];

  for (const input of cases) {
    assertEquals(await planTutorialFieldDiscovery(input), {
      eligible: false,
      chancePercent: 0,
      roll: null,
      shouldOffer: false,
      slot: null,
    });
  }
});
