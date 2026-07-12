import { assertEquals } from "jsr:@std/assert@1.0.19";
import type {
  CompanionSnapshot,
  SelfSnapshot,
} from "../../supabase/functions/_shared/contracts/domain.ts";
import { aggregateParty } from "../../supabase/functions/_shared/domain/resolvers/v1/party.ts";

const self: SelfSnapshot = {
  maxHp: 40,
  physical: 12,
  magical: 8,
  agility: 12,
  vitality: 9,
  defense: 15,
  vampRateBps: 750,
  postHeal: 3,
};
const companion: CompanionSnapshot = {
  maxHp: 55,
  physical: 7,
  magical: 20,
  agility: 8,
  defense: 8,
};

Deno.test("solo aggregation preserves the self snapshot", () => {
  const result = aggregateParty({ mode: "solo", self, companion: null });
  assertEquals(result.total, {
    maxHp: 40,
    physical: 12,
    magical: 8,
    agility: 12,
    vitality: 9,
    defense: 15,
  });
  assertEquals(result.breakdown.companion, null);
  assertEquals(result.support, { vampRateBps: 750, postHeal: 3 });
});

Deno.test("partner aggregation exposes exact totals and assists", () => {
  const before = structuredClone({ self, companion });
  const result = aggregateParty({ mode: "partner", self, companion });
  assertEquals(result.total, {
    maxHp: 95,
    physical: 19,
    magical: 28,
    agility: 14,
    vitality: 9,
    defense: 19,
  });
  assertEquals(result.breakdown.agilityAssist, 2);
  assertEquals(result.breakdown.defenseAssist, 4);
  assertEquals({ self, companion }, before);
});

Deno.test("tutorial uses the same immutable companion formula", () => {
  const result = aggregateParty({ mode: "tutorial", self, companion });
  assertEquals(result.mode, "tutorial");
  assertEquals(result.total.maxHp, 95);
  assertEquals(result.total.agility, 14);
});
