import type { CheckTier, Stat, TacticalModifier } from "./content.ts";

export type PartyMode = "solo" | "tutorial" | "partner";
export type Outcome = "success" | "neutral" | "failure";
export type TerminalResult = "victory" | "contained" | "defeated";

export interface SelfSnapshot {
  readonly maxHp: number;
  readonly physical: number;
  readonly magical: number;
  readonly agility: number;
  readonly vitality: number;
  readonly defense: number;
  readonly vampRateBps: number;
  readonly postHeal: number;
}

export interface CompanionSnapshot {
  readonly maxHp: number;
  readonly physical: number;
  readonly magical: number;
  readonly agility: number;
  readonly defense: number;
}

export type PartySnapshot =
  | {
    readonly mode: "solo";
    readonly self: SelfSnapshot;
    readonly companion: null;
  }
  | {
    readonly mode: "tutorial" | "partner";
    readonly self: SelfSnapshot;
    readonly companion: CompanionSnapshot;
  };

export interface AggregatedPartyValues {
  readonly maxHp: number;
  readonly physical: number;
  readonly magical: number;
  readonly agility: number;
  readonly vitality: number;
  readonly defense: number;
}

export interface AggregatedParty {
  readonly mode: PartyMode;
  readonly total: AggregatedPartyValues;
  readonly support: {
    readonly vampRateBps: number;
    readonly postHeal: number;
  };
  readonly breakdown: {
    readonly self: SelfSnapshot;
    readonly companion: CompanionSnapshot | null;
    readonly agilityAssist: number;
    readonly defenseAssist: number;
  };
}

export interface RunStateV1 {
  readonly stage: number;
  readonly exchange: 1 | 2 | null;
  readonly hp: number;
  readonly bossHp: number | null;
  readonly xp: number;
  readonly vampHealedStage: number;
  readonly vampHealedRun: number;
  readonly terminal: TerminalResult | null;
}

export interface ChoiceCommandV1 {
  readonly resolverVersion: "v1";
  readonly stage: number;
  readonly exchange: 1 | 2 | null;
  readonly choiceId: string;
}

export interface ResolverConfigV1 {
  readonly stageThresholds: readonly number[];
  readonly tierDelta: Readonly<Record<CheckTier, number>>;
  readonly tacticalBandDelta: Readonly<Record<TacticalModifier, number>>;
  readonly successDamage: readonly number[];
  readonly neutralDamage: readonly number[];
  readonly failureDamage: readonly number[];
  readonly stageXp: readonly number[];
  readonly neutralXpPercent: number;
  readonly bossMaxHp: number;
  readonly bossDamage: readonly [number, number];
  readonly bossOwnerDamage: readonly [number, number];
  readonly bossNeutralDamagePercent: number;
  readonly bossCounterIncomingPercent: number;
  readonly bossFailureIncomingPercent: number;
  readonly defenseScale: number;
  readonly vampStageCapBps: number;
  readonly vampRunCapBps: number;
  readonly dailyXpCap: number;
}

export interface ResolutionV1 {
  readonly resolverVersion: "v1";
  readonly stage: number;
  readonly exchange: 1 | 2 | null;
  readonly choiceId: string;
  readonly outcome: Outcome;
  readonly clue: { readonly id: string; readonly text: string };
  readonly rationale: string;
  readonly check: {
    readonly stat: Stat;
    readonly selfPower: number;
    readonly companionPower: number;
    readonly totalPower: number;
    readonly threshold: number;
  } | null;
  readonly hp: {
    readonly before: number;
    readonly damage: number;
    readonly vampHeal: number;
    readonly postHeal: number;
    readonly after: number;
  };
  readonly bossHp: {
    readonly before: number;
    readonly ownerDamage: number;
    readonly after: number;
  } | null;
  readonly xp: {
    readonly before: number;
    readonly delta: number;
    readonly after: number;
  };
  readonly terminal: TerminalResult | null;
  readonly nextStage: number | null;
  readonly nextExchange: 2 | null;
}
