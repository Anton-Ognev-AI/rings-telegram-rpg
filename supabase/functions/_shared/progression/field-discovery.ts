import { sha256Hex } from "../domain/canonical-json.ts";

export type FieldDiscoveryOutcome = "success" | "neutral" | "failure";
export type FieldDiscoverySlot = "armor" | "talisman";

export interface TutorialFieldDiscoveryInput {
  readonly runId: string;
  readonly tutorialOrdinal: 1 | 2 | null;
  readonly resolvedStage: number;
  readonly outcome: FieldDiscoveryOutcome;
  readonly terminal: boolean;
  readonly hasHistoricalDiscovery: boolean;
  readonly hasPendingOffer: boolean;
  readonly occupiedSupportSlots: readonly FieldDiscoverySlot[];
}

export interface TutorialFieldDiscoveryPlan {
  readonly eligible: boolean;
  readonly chancePercent: number;
  readonly roll: number | null;
  readonly shouldOffer: boolean;
  readonly slot: FieldDiscoverySlot | null;
}

const INELIGIBLE: TutorialFieldDiscoveryPlan = Object.freeze({
  eligible: false,
  chancePercent: 0,
  roll: null,
  shouldOffer: false,
  slot: null,
});

const CHANCES: Readonly<Record<1 | 2 | 3, Readonly<Record<FieldDiscoveryOutcome, number>>>> = {
  1: { success: 30, neutral: 20, failure: 10 },
  2: { success: 65, neutral: 50, failure: 30 },
  3: { success: 100, neutral: 100, failure: 100 },
};

export function fieldDiscoveryChance(stage: number, outcome: FieldDiscoveryOutcome): number {
  if (stage !== 1 && stage !== 2 && stage !== 3) return 0;
  return CHANCES[stage][outcome];
}

async function deterministicInteger(input: string): Promise<number> {
  const digest = await sha256Hex(input);
  return Number.parseInt(digest.slice(0, 8), 16);
}

async function chooseSlot(
  runId: string,
  occupied: ReadonlySet<FieldDiscoverySlot>,
): Promise<FieldDiscoverySlot | null> {
  const armorOpen = !occupied.has("armor");
  const talismanOpen = !occupied.has("talisman");
  if (!armorOpen && !talismanOpen) return null;
  if (!armorOpen) return "talisman";
  if (!talismanOpen) return "armor";
  const selector = await deterministicInteger(`field-discovery-slot-v1|${runId}`);
  return selector % 2 === 0 ? "armor" : "talisman";
}

export async function planTutorialFieldDiscovery(
  input: TutorialFieldDiscoveryInput,
): Promise<TutorialFieldDiscoveryPlan> {
  const occupied = new Set(input.occupiedSupportSlots);
  const chancePercent = fieldDiscoveryChance(input.resolvedStage, input.outcome);
  if (
    input.tutorialOrdinal !== 1 || input.terminal || input.hasHistoricalDiscovery ||
    input.hasPendingOffer || chancePercent === 0 || occupied.size >= 2
  ) {
    return INELIGIBLE;
  }

  const rollValue = await deterministicInteger(
    `field-discovery-roll-v1|${input.runId}|${input.resolvedStage}|${input.outcome}`,
  );
  const roll = (rollValue % 100) + 1;
  const shouldOffer = roll <= chancePercent;
  return {
    eligible: true,
    chancePercent,
    roll,
    shouldOffer,
    slot: shouldOffer ? await chooseSlot(input.runId, occupied) : null,
  };
}
