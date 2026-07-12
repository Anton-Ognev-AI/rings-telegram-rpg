export interface CombatExchangeInput {
  readonly hp: number;
  readonly maxHp: number;
  readonly bossHp: number;
  readonly ownerDamage: number;
  readonly incomingDamage: number;
  readonly defense: number;
  readonly defenseScale: number;
  readonly vampRateBps: number;
  readonly vampStageCapBps: number;
  readonly vampRunCapBps: number;
  readonly vampHealedStage: number;
  readonly vampHealedRun: number;
  readonly postHeal: number;
}

export interface CombatExchangeResult {
  readonly hp: number;
  readonly bossHp: number;
  readonly actualOwnerDamage: number;
  readonly incomingDamage: number;
  readonly vampHeal: number;
  readonly postHeal: number;
  readonly vampHealedStage: number;
  readonly vampHealedRun: number;
}

export function applyHeal(hp: number, maxHp: number, amount: number): number {
  if (hp <= 0) return 0;
  return Math.min(Math.max(0, maxHp), hp + Math.max(0, amount));
}

export function mitigateDamage(raw: number, defense: number, scale: number): number {
  if (raw <= 0) return 0;
  const safeScale = Math.max(1, scale);
  return Math.max(
    1,
    Math.floor(raw * safeScale / (safeScale + Math.max(0, defense))),
  );
}

export function resolveCombatExchange(input: CombatExchangeInput): CombatExchangeResult {
  const maxHp = Math.max(0, input.maxHp);
  const startingHp = Math.min(maxHp, Math.max(0, input.hp));
  const startingBossHp = Math.max(0, input.bossHp);
  const actualOwnerDamage = Math.min(startingBossHp, Math.max(0, input.ownerDamage));
  const bossHp = startingBossHp - actualOwnerDamage;

  const rawVamp = Math.floor(
    actualOwnerDamage * Math.max(0, input.vampRateBps) / 10_000,
  );
  const stageRoom = Math.max(
    0,
    Math.floor(maxHp * Math.max(0, input.vampStageCapBps) / 10_000) -
      Math.max(0, input.vampHealedStage),
  );
  const runRoom = Math.max(
    0,
    Math.floor(maxHp * Math.max(0, input.vampRunCapBps) / 10_000) -
      Math.max(0, input.vampHealedRun),
  );
  const requestedVamp = Math.min(rawVamp, stageRoom, runRoom);
  let hp = applyHeal(startingHp, maxHp, requestedVamp);
  const vampHeal = hp - startingHp;

  const incomingDamage = bossHp === 0
    ? 0
    : mitigateDamage(input.incomingDamage, input.defense, input.defenseScale);
  hp = Math.max(0, hp - incomingDamage);
  const hpBeforePostHeal = hp;
  hp = applyHeal(hp, maxHp, input.postHeal);
  const postHeal = hp - hpBeforePostHeal;

  return {
    hp,
    bossHp,
    actualOwnerDamage,
    incomingDamage,
    vampHeal,
    postHeal,
    vampHealedStage: Math.max(0, input.vampHealedStage) + vampHeal,
    vampHealedRun: Math.max(0, input.vampHealedRun) + vampHeal,
  };
}
