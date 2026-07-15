import type { SelfSnapshot } from "../contracts/domain.ts";
import {
  STARTER_ITEM_CATALOG,
  STARTER_RING_CATALOG,
  type StarterItemKey,
  type StarterRingKind,
} from "./catalog.ts";

export interface BuildContribution {
  readonly source: string;
  readonly label: string;
  readonly operation: "add" | "multiply";
  readonly amount: number;
  readonly result: number;
  readonly bps: number | null;
}

export interface CanonicalBuildView {
  readonly selfSnapshot: SelfSnapshot;
  readonly loadoutSnapshot: {
    readonly progressionConfig: "progression-v1";
    readonly items: readonly {
      readonly slot: "main" | "armor" | "talisman";
      readonly itemKey: StarterItemKey;
      readonly rarity: "ordinary";
      readonly label: string;
      readonly bonuses: Readonly<Record<string, number>>;
    }[];
    readonly rings: readonly {
      readonly kind: StarterRingKind;
      readonly color: "blue";
      readonly rarity: "ordinary";
      readonly label: string;
      readonly masteryPercent: number;
      readonly investedXp: number;
      readonly blueBudget: 2000;
      readonly combatBps: number;
    }[];
  };
  readonly breakdown: Readonly<
    Record<
      "physical" | "magical" | "agility" | "vitality" | "defense" | "maxHp" | "postHeal",
      readonly BuildContribution[]
    >
  >;
}

function invalid(): never {
  throw new Error("invalid_canonical_build");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sameRecord(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, number>>,
): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function validateSelfSnapshot(value: unknown): void {
  if (!isRecord(value)) invalid();
  const keys: readonly (keyof SelfSnapshot)[] = [
    "maxHp",
    "physical",
    "magical",
    "agility",
    "vitality",
    "defense",
    "vampRateBps",
    "postHeal",
  ];
  if (!keys.every((key) => safeInteger(value[key])) || value.maxHp === 0) invalid();
}

function validateLoadout(value: unknown): void {
  if (!isRecord(value) || value.progressionConfig !== "progression-v1") invalid();
  if (!Array.isArray(value.items) || !Array.isArray(value.rings) || value.rings.length > 1) {
    invalid();
  }

  const occupied = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.itemKey !== "string") invalid();
    if (!(item.itemKey in STARTER_ITEM_CATALOG)) invalid();
    const itemKey = item.itemKey as StarterItemKey;
    const catalog = STARTER_ITEM_CATALOG[itemKey];
    if (
      item.slot !== catalog.slot || item.label !== catalog.label || item.rarity !== "ordinary" ||
      !isRecord(item.bonuses) || !sameRecord(item.bonuses, catalog.bonuses) ||
      occupied.has(catalog.slot)
    ) invalid();
    occupied.add(catalog.slot);
  }

  for (const ring of value.rings) {
    if (!isRecord(ring) || typeof ring.kind !== "string") invalid();
    if (!(ring.kind in STARTER_RING_CATALOG)) invalid();
    const ringKind = ring.kind as StarterRingKind;
    const catalog = STARTER_RING_CATALOG[ringKind];
    if (
      ring.color !== "blue" || ring.rarity !== "ordinary" || ring.label !== catalog.label ||
      ring.combatBps !== catalog.combatBps || ring.blueBudget !== 2000 ||
      !safeInteger(ring.masteryPercent) || ring.masteryPercent > 100 ||
      !safeInteger(ring.investedXp)
    ) invalid();
  }
}

function validateBreakdown(value: unknown): void {
  if (!isRecord(value)) invalid();
  const stats = [
    "physical",
    "magical",
    "agility",
    "vitality",
    "defense",
    "maxHp",
    "postHeal",
  ] as const;
  if (!stats.every((stat) => Array.isArray(value[stat]))) invalid();
  for (const stat of stats) {
    for (const contribution of value[stat] as readonly unknown[]) {
      if (
        !isRecord(contribution) || typeof contribution.source !== "string" ||
        contribution.source.length === 0 || typeof contribution.label !== "string" ||
        contribution.label.length === 0 ||
        (contribution.operation !== "add" && contribution.operation !== "multiply") ||
        !safeInteger(contribution.amount) || !safeInteger(contribution.result) ||
        (contribution.bps !== null && !safeInteger(contribution.bps)) ||
        (contribution.operation === "add" && contribution.bps !== null) ||
        (contribution.operation === "multiply" && contribution.bps === null)
      ) invalid();
    }
  }
}

export function parseCanonicalBuildView(value: unknown): CanonicalBuildView {
  if (!isRecord(value)) invalid();
  validateSelfSnapshot(value.selfSnapshot);
  validateLoadout(value.loadoutSnapshot);
  validateBreakdown(value.breakdown);
  return value as unknown as CanonicalBuildView;
}
