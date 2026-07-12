import type { ResolverConfigV1 } from "../../../contracts/domain.ts";

export const CONFIG_V1 = Object.freeze(
  {
    stageThresholds: [5, 7, 10, 14, 19, 25, 32, 40, 49, 60],
    tierDelta: { easy: -2, standard: 0, hard: 5 },
    tacticalBandDelta: { counter: -1, standard: 0, against_telegraph: 1 },
    successDamage: [0, 0, 1, 2, 3, 3, 4, 5, 5, 0],
    neutralDamage: [2, 2, 3, 4, 6, 6, 7, 8, 8, 0],
    failureDamage: [5, 6, 8, 10, 13, 14, 16, 18, 20, 0],
    stageXp: [10, 15, 18, 20, 27, 10, 12, 13, 10, 15],
    neutralXpPercent: 20,
    bossMaxHp: 90,
    bossDamage: [24, 34],
    bossOwnerDamage: [32, 58],
    bossNeutralDamagePercent: 25,
    bossCounterIncomingPercent: 50,
    bossFailureIncomingPercent: 150,
    defenseScale: 100,
    vampStageCapBps: 800,
    vampRunCapBps: 2500,
    dailyXpCap: 150,
  } as const satisfies ResolverConfigV1,
);
