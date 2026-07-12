import { assertEquals } from "jsr:@std/assert@1.0.19";
import type {
  CompanionSnapshot,
  SelfSnapshot,
} from "../../supabase/functions/_shared/contracts/domain.ts";
import { aggregateParty } from "../../supabase/functions/_shared/domain/resolvers/v1/party.ts";

Deno.test("party formulas hold for deterministic integer pairs", () => {
  for (let a = 0; a <= 100; a++) {
    for (let b = 0; b <= 100; b++) {
      const self: SelfSnapshot = {
        maxHp: a,
        physical: a,
        magical: a,
        agility: a,
        vitality: 17,
        defense: a,
        vampRateBps: 0,
        postHeal: 0,
      };
      const companion: CompanionSnapshot = {
        maxHp: b,
        physical: b,
        magical: b,
        agility: b,
        defense: b,
      };
      const result = aggregateParty({ mode: "partner", self, companion });
      assertEquals(result.total.maxHp, a + b);
      assertEquals(result.total.physical, a + b);
      assertEquals(result.total.magical, a + b);
      assertEquals(result.total.agility, Math.max(a, b) + Math.floor(Math.min(a, b) / 4));
      assertEquals(result.total.defense, Math.max(a, b) + Math.floor(Math.min(a, b) / 2));
      assertEquals(result.total.vitality, 17);
    }
  }
});
