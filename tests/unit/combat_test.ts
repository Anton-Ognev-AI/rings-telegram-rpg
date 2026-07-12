import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  applyHeal,
  mitigateDamage,
  resolveCombatExchange,
} from "../../supabase/functions/_shared/domain/resolvers/v1/combat.ts";

const caps = { vampStageCapBps: 800, vampRunCapBps: 2500 } as const;

Deno.test("healing neither resurrects nor exceeds max HP", () => {
  assertEquals(applyHeal(0, 100, 30), 0);
  assertEquals(applyHeal(90, 100, 30), 100);
  assertEquals(applyHeal(40, 100, -5), 40);
});

Deno.test("defense follows the configured diminishing curve", () => {
  assertEquals(mitigateDamage(0, 50, 100), 0);
  assertEquals(mitigateDamage(100, 100, 100), 50);
  assertEquals(mitigateDamage(1, 10_000, 100), 1);
});

Deno.test("owner damage is non-overkill and boss death suppresses counter", () => {
  const result = resolveCombatExchange({
    hp: 20,
    maxHp: 100,
    bossHp: 5,
    ownerDamage: 20,
    incomingDamage: 99,
    defense: 0,
    defenseScale: 100,
    vampRateBps: 5000,
    ...caps,
    vampHealedStage: 0,
    vampHealedRun: 0,
    postHeal: 10,
  });
  assertEquals(
    {
      bossHp: result.bossHp,
      actualOwnerDamage: result.actualOwnerDamage,
      incomingDamage: result.incomingDamage,
      vampHeal: result.vampHeal,
      postHeal: result.postHeal,
      hp: result.hp,
    },
    { bossHp: 0, actualOwnerDamage: 5, incomingDamage: 0, vampHeal: 2, postHeal: 10, hp: 32 },
  );
});

Deno.test("stage and run vamp caps use actual healing", () => {
  const base = {
    hp: 10,
    maxHp: 100,
    bossHp: 100,
    ownerDamage: 100,
    incomingDamage: 0,
    defense: 0,
    defenseScale: 100,
    vampRateBps: 10_000,
    ...caps,
    postHeal: 0,
  };
  assertEquals(
    resolveCombatExchange({ ...base, vampHealedStage: 7, vampHealedRun: 0 }).vampHeal,
    1,
  );
  assertEquals(
    resolveCombatExchange({ ...base, vampHealedStage: 0, vampHealedRun: 24 }).vampHeal,
    1,
  );
});

Deno.test("lethal counter prevents post-exchange healing", () => {
  const result = resolveCombatExchange({
    hp: 10,
    maxHp: 100,
    bossHp: 100,
    ownerDamage: 1,
    incomingDamage: 50,
    defense: 0,
    defenseScale: 100,
    vampRateBps: 0,
    ...caps,
    vampHealedStage: 0,
    vampHealedRun: 0,
    postHeal: 100,
  });
  assertEquals({ hp: result.hp, incoming: result.incomingDamage, postHeal: result.postHeal }, {
    hp: 0,
    incoming: 50,
    postHeal: 0,
  });
});
