export type Stat = "physical" | "magical" | "agility" | "vitality";

export type EncounterType =
  | "exploration"
  | "research"
  | "social"
  | "hazard"
  | "pursuit"
  | "combat";

export type StageRole =
  | "entry"
  | "clue"
  | "application"
  | "resistance"
  | "miniboss"
  | "counterplay"
  | "escalation"
  | "dilemma"
  | "synthesis"
  | "boss";

export type ChoiceKind = "check" | "neutral" | "trap";
export type CheckTier = "easy" | "standard" | "hard";
export type TacticalModifier = "counter" | "standard" | "against_telegraph";

export interface ClueV1 {
  readonly id: string;
  readonly text: string;
}

export interface ChoiceCopyV1 {
  readonly success: string;
  readonly neutral: string;
  readonly failure: string;
}

export interface ChoiceV1 {
  readonly id: string;
  readonly label: string;
  readonly kind: ChoiceKind;
  readonly clueId: string;
  readonly rationale: string;
  readonly stat?: Stat;
  readonly tier?: CheckTier;
  readonly tacticalModifier?: TacticalModifier;
  readonly copy: ChoiceCopyV1;
}

export interface BossExchangeV1 {
  readonly number: 1 | 2;
  readonly scene: string;
  readonly choices: readonly ChoiceV1[];
}

export interface StageV1 {
  readonly number: number;
  readonly role: StageRole;
  readonly encounterType: EncounterType;
  readonly scene: string;
  readonly important: boolean;
  readonly clues: readonly ClueV1[];
  readonly choices?: readonly ChoiceV1[];
  readonly bossExchanges?: readonly BossExchangeV1[];
}

export interface DungeonContentV1 {
  readonly schemaVersion: "dungeon-v1";
  readonly resolverVersion: "v1";
  readonly id: string;
  readonly title: string;
  readonly stages: readonly StageV1[];
}
