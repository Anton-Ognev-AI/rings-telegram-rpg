import { assert } from "jsr:@std/assert@1.0.19";
import { resolveCombatExchange } from "../../supabase/functions/_shared/domain/resolvers/v1/combat.ts";

Deno.test("combat exchange preserves HP, damage, heal, and vamp invariants", () => {
  for (const maxHp of [1, 20, 100]) {
    for (const hp of [0, 1, maxHp]) {
      for (const bossHp of [0, 1, 50]) {
        for (const damage of [0, 1, 100]) {
          for (const incomingDamage of [0, 5, 100]) {
            const result = resolveCombatExchange({
              hp,
              maxHp,
              bossHp,
              ownerDamage: damage,
              incomingDamage,
              defense: 20,
              defenseScale: 100,
              vampRateBps: 5000,
              vampStageCapBps: 800,
              vampRunCapBps: 2500,
              vampHealedStage: 0,
              vampHealedRun: 0,
              postHeal: 9,
            });
            assert(result.hp >= 0 && result.hp <= maxHp);
            assert(result.bossHp >= 0 && result.bossHp <= bossHp);
            assert(result.actualOwnerDamage <= bossHp);
            assert(result.vampHeal <= Math.floor(result.actualOwnerDamage / 2));
            assert(result.vampHeal <= Math.floor(maxHp * 0.08));
            assert(result.vampHealedRun <= Math.floor(maxHp * 0.25));
            if (hp === 0) assert(result.hp === 0);
            if (result.bossHp === 0) assert(result.incomingDamage === 0);
            if (result.hp === 0) assert(result.postHeal === 0);
          }
        }
      }
    }
  }
});
