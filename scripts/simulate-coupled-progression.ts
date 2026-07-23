import type {
  CompanionSnapshot,
  PartySnapshot,
  SelfSnapshot,
} from "../supabase/functions/_shared/contracts/domain.ts";
import { canonicalJson, sha256Hex } from "../supabase/functions/_shared/domain/canonical-json.ts";
import { mitigateDamage } from "../supabase/functions/_shared/domain/resolvers/v1/combat.ts";
import { aggregateParty } from "../supabase/functions/_shared/domain/resolvers/v1/party.ts";
import {
  STARTER_ITEM_CATALOG,
  STARTER_RING_CATALOG,
} from "../supabase/functions/_shared/progression/catalog.ts";
import {
  CANDIDATE_V2_CURVES,
  candidateMaxHp,
  cumulativeStatCost,
  deepestPassingStage,
  projectedStatCost,
  stageCurve,
} from "./simulate-progression-curves.ts";
import {
  baselineRingDominancePairs,
  pairwiseDominancePairs,
  simulateStarterBuildMatrix,
  simulateSurvivalAwareStarterMatrix,
} from "./simulate-starter-builds.ts";

export type CandidateFocus = "physical" | "magical" | "defensive" | "healing";
export type CandidateStrategy = "focused_stat" | "balanced_stats" | "ring_first";
export type CandidateXpBudget = 43 | 150 | 2700 | 18000 | 78000;
export type CandidateEquipment = "main_only" | "full_three";
export type CandidateParty = "solo" | "teacher" | "peer" | "strong_friend";
export type CandidateRing = "weapon" | "fire" | "defense" | "healing";
export type CandidateRingColor = "blue" | "green" | "yellow" | "purple";
type CandidateStat = "physical" | "magical" | "agility" | "vitality";
type StageCap = 10 | 12 | 20;
type Depths = Readonly<Record<`${StageCap}`, number | null>>;

export interface CandidateRow {
  readonly key: string;
  readonly focus: CandidateFocus;
  readonly strategy: CandidateStrategy;
  readonly xpBudget: CandidateXpBudget;
  readonly equipment: CandidateEquipment;
  readonly party: CandidateParty;
  readonly supported: boolean;
  readonly ring: {
    readonly kind: CandidateRing;
    readonly color: CandidateRingColor;
  };
  readonly fittingDepth: Depths;
  readonly neutralDepth: Depths;
  readonly failureDepth: Depths;
}

export interface CoupledProgressionReport {
  readonly version: "coupled-progression-matrix-v1";
  readonly provenance: {
    readonly currentV1: "resolver-v1+fallback-day-01+starter-matrix";
    readonly candidateV2: "adr-076+game-design-v1.1+aggregate-party";
    readonly healingUnsupported: "missing-higher-color-healing-output";
  };
  readonly coverage: {
    readonly unsupported: readonly [
      "healing:green",
      "healing:yellow",
      "healing:purple",
    ];
  };
  readonly currentV1: {
    readonly reportCount: number;
    readonly dominancePairs: ReturnType<typeof pairwiseDominancePairs>;
    readonly baselineDominancePairs: ReturnType<typeof baselineRingDominancePairs>;
    readonly earnedXp: EarnedXpDistribution;
  };
  readonly candidateV2: {
    readonly rows: readonly CandidateRow[];
  };
  readonly economy: {
    readonly observedDailyXp: readonly number[];
    readonly scenarioDailyXp: readonly number[];
    readonly ringMilestones: readonly RingMilestone[];
    readonly focusedStatCapXp: number;
    readonly balancedFourStatCapXp: number;
    readonly early43: {
      readonly focusedPurchases: number;
      readonly balancedPurchases: number;
    };
  };
  readonly sessionLoad: readonly SessionLoad[];
  readonly recommendation: "keep-10-until-healing-v2-content-and-owner-session-evidence";
  readonly reportHash: string;
}

interface RingMilestone {
  readonly dailyXp: number;
  readonly onePurpleDays: number;
  readonly onePurpleYears: number;
  readonly twoPurpleDays: number;
  readonly twoPurpleYears: number;
}

interface EarnedXpDistribution {
  readonly samples: number;
  readonly min: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly max: number;
  readonly unique: readonly number[];
}

interface SessionLoad {
  readonly stages: StageCap;
  readonly decisions: number;
  readonly maximumWithOneOffer: number;
}

interface Allocation {
  readonly purchases: Readonly<Record<CandidateStat, number>>;
  readonly ringXp: number;
}

const FOCUSES = ["physical", "magical", "defensive", "healing"] as const;
const STRATEGIES = ["focused_stat", "balanced_stats", "ring_first"] as const;
const XP_BUDGETS = [43, 150, 2700, 18000, 78000] as const;
const EQUIPMENT = ["main_only", "full_three"] as const;
const PARTIES = ["solo", "teacher", "peer", "strong_friend"] as const;
const STAGE_CAPS = [10, 12, 20] as const;
const PURPLE_RING_XP = 78_000;
const RING_COMBAT_BPS: Readonly<Record<CandidateRingColor, number>> = {
  blue: STARTER_RING_CATALOG.weapon.combatBps,
  green: 3500,
  yellow: 8000,
  purple: 14_000,
};

function focusStat(focus: CandidateFocus): CandidateStat {
  if (focus === "physical") return "physical";
  if (focus === "magical") return "magical";
  return "vitality";
}

function ringKind(focus: CandidateFocus): CandidateRing {
  if (focus === "physical") return "weapon";
  if (focus === "magical") return "fire";
  if (focus === "defensive") return "defense";
  return "healing";
}

function ringColor(ringXp: number): CandidateRingColor {
  if (ringXp >= 78_000) return "purple";
  if (ringXp >= 18_000) return "yellow";
  if (ringXp >= 2_000) return "green";
  return "blue";
}

function emptyPurchases(): Record<CandidateStat, number> {
  return { physical: 0, magical: 0, agility: 0, vitality: 0 };
}

function spendFocused(
  purchases: Record<CandidateStat, number>,
  stat: CandidateStat,
  xp: number,
): number {
  let remaining = xp;
  while (purchases[stat] < 30) {
    const cost = projectedStatCost(CANDIDATE_V2_CURVES, purchases[stat]);
    if (cost > remaining) break;
    purchases[stat] += 1;
    remaining -= cost;
  }
  return remaining;
}

function balancedOrder(focus: CandidateFocus): readonly CandidateStat[] {
  if (focus === "physical") return ["physical", "magical", "agility", "vitality"];
  if (focus === "magical") return ["magical", "physical", "agility", "vitality"];
  if (focus === "defensive") return ["vitality", "physical", "magical", "agility"];
  return ["vitality", "magical", "physical", "agility"];
}

function spendBalanced(
  purchases: Record<CandidateStat, number>,
  focus: CandidateFocus,
  xp: number,
): number {
  const order = balancedOrder(focus);
  let remaining = xp;
  let cursor = 0;
  while (true) {
    let bought = false;
    for (let offset = 0; offset < order.length; offset += 1) {
      const index = (cursor + offset) % order.length;
      const stat = order[index]!;
      if (purchases[stat] >= 30) continue;
      const cost = projectedStatCost(CANDIDATE_V2_CURVES, purchases[stat]);
      if (cost > remaining) continue;
      purchases[stat] += 1;
      remaining -= cost;
      cursor = (index + 1) % order.length;
      bought = true;
      break;
    }
    if (!bought) return remaining;
  }
}

function allocate(
  focus: CandidateFocus,
  strategy: CandidateStrategy,
  xpBudget: CandidateXpBudget,
): Allocation {
  const purchases = emptyPurchases();
  if (strategy === "ring_first") {
    const ringXp = Math.min(xpBudget, PURPLE_RING_XP);
    spendFocused(purchases, focusStat(focus), xpBudget - ringXp);
    return { purchases, ringXp };
  }
  if (strategy === "balanced_stats") {
    spendBalanced(purchases, focus, xpBudget);
  } else {
    spendFocused(purchases, focusStat(focus), xpBudget);
  }
  return { purchases, ringXp: 0 };
}

function applyRing(value: number, color: CandidateRingColor): number {
  return Math.floor(value * (10_000 + RING_COMBAT_BPS[color]) / 10_000);
}

function buildSelf(
  focus: CandidateFocus,
  strategy: CandidateStrategy,
  xpBudget: CandidateXpBudget,
  equipment: CandidateEquipment,
): SelfSnapshot {
  const allocation = allocate(focus, strategy, xpBudget);
  const color = ringColor(allocation.ringXp);
  const kind = ringKind(focus);
  const { purchases } = allocation;
  const physicalItem = focus === "physical" || focus === "defensive"
    ? STARTER_ITEM_CATALOG.training_sword.bonuses.physical
    : 0;
  const magicalItem = focus === "magical" || focus === "healing"
    ? STARTER_ITEM_CATALOG.apprentice_focus.bonuses.magical
    : 0;
  const armorDefense = equipment === "full_three"
    ? STARTER_ITEM_CATALOG.training_armor.bonuses.defense
    : 0;
  const talismanHp = equipment === "full_three"
    ? STARTER_ITEM_CATALOG.student_talisman.bonuses.maxHp
    : 0;

  let physical = 5 + purchases.physical + physicalItem;
  let magical = 5 + purchases.magical + magicalItem;
  const agility = 5 + purchases.agility;
  const vitality = 5 + purchases.vitality;
  let defense = 5 + armorDefense + Math.floor(purchases.vitality / 3);

  if (kind === "weapon") physical = applyRing(physical, color);
  if (kind === "fire") magical = applyRing(magical, color);
  if (kind === "defense") defense = applyRing(defense, color);

  return {
    maxHp: candidateMaxHp(vitality) + talismanHp,
    physical,
    magical,
    agility,
    vitality,
    defense,
    vampRateBps: 0,
    postHeal: kind === "healing" && color === "blue" ? 1 : 0,
  };
}

function asCompanion(self: SelfSnapshot): CompanionSnapshot {
  return {
    maxHp: self.maxHp,
    physical: self.physical,
    magical: self.magical,
    agility: self.agility,
    defense: self.defense,
  };
}

function nextXpBudget(xpBudget: CandidateXpBudget): CandidateXpBudget {
  const index = XP_BUDGETS.indexOf(xpBudget);
  return XP_BUDGETS[Math.min(index + 1, XP_BUDGETS.length - 1)]!;
}

function partySnapshot(
  focus: CandidateFocus,
  strategy: CandidateStrategy,
  xpBudget: CandidateXpBudget,
  equipment: CandidateEquipment,
  party: CandidateParty,
): PartySnapshot {
  const self = buildSelf(focus, strategy, xpBudget, equipment);
  if (party === "solo") return { mode: "solo", self, companion: null };
  if (party === "teacher") {
    return {
      mode: "tutorial",
      self,
      companion: { maxHp: 5, physical: 4, magical: 4, agility: 4, defense: 2 },
    };
  }
  const companion = party === "peer" ? asCompanion(self) : asCompanion(
    buildSelf(focus, "focused_stat", nextXpBudget(xpBudget), equipment),
  );
  return { mode: "partner", self, companion };
}

function fittingPower(snapshot: PartySnapshot, focus: CandidateFocus): number {
  const total = aggregateParty(snapshot).total;
  if (focus === "physical") return total.physical;
  if (focus === "magical") return total.magical;
  return total.vitality;
}

function attritionDepth(
  snapshot: PartySnapshot,
  outcome: "neutral" | "failure",
  maxStages: StageCap,
): number {
  const party = aggregateParty(snapshot);
  const maxHp = party.total.maxHp;
  const damages = stageCurve(CANDIDATE_V2_CURVES, outcome, maxStages);
  let hp = maxHp;
  let completed = 0;
  for (const rawDamage of damages) {
    hp = Math.max(
      0,
      hp -
        mitigateDamage(
          rawDamage,
          party.total.defense,
          CANDIDATE_V2_CURVES.defenseScale,
        ),
    );
    if (hp === 0) return completed;
    hp = Math.min(maxHp, hp + party.support.postHeal);
    completed += 1;
  }
  return completed;
}

function nullDepths(): Depths {
  return { "10": null, "12": null, "20": null };
}

function supportedDepths(
  snapshot: PartySnapshot,
  focus: CandidateFocus,
  kind: "fitting" | "neutral" | "failure",
): Depths {
  return Object.fromEntries(
    STAGE_CAPS.map((maxStages) => {
      const depth = kind === "fitting"
        ? deepestPassingStage(
          CANDIDATE_V2_CURVES,
          fittingPower(snapshot, focus),
          -3,
          maxStages,
        )
        : attritionDepth(snapshot, kind, maxStages);
      return [String(maxStages), depth];
    }),
  ) as Depths;
}

function candidateKey(
  focus: CandidateFocus,
  strategy: CandidateStrategy,
  xpBudget: CandidateXpBudget,
  equipment: CandidateEquipment,
  party: CandidateParty,
): string {
  return `${focus}:${strategy}:${xpBudget}:${equipment}:${party}`;
}

function candidateRow(
  focus: CandidateFocus,
  strategy: CandidateStrategy,
  xpBudget: CandidateXpBudget,
  equipment: CandidateEquipment,
  party: CandidateParty,
): CandidateRow {
  const allocation = allocate(focus, strategy, xpBudget);
  const kind = ringKind(focus);
  const color = ringColor(allocation.ringXp);
  const supported = !(kind === "healing" && color !== "blue");
  if (!supported) {
    return {
      key: candidateKey(focus, strategy, xpBudget, equipment, party),
      focus,
      strategy,
      xpBudget,
      equipment,
      party,
      supported,
      ring: { kind, color },
      fittingDepth: nullDepths(),
      neutralDepth: nullDepths(),
      failureDepth: nullDepths(),
    };
  }
  const snapshot = partySnapshot(focus, strategy, xpBudget, equipment, party);
  return {
    key: candidateKey(focus, strategy, xpBudget, equipment, party),
    focus,
    strategy,
    xpBudget,
    equipment,
    party,
    supported,
    ring: { kind, color },
    fittingDepth: supportedDepths(snapshot, focus, "fitting"),
    neutralDepth: supportedDepths(snapshot, focus, "neutral"),
    failureDepth: supportedDepths(snapshot, focus, "failure"),
  };
}

function expectedCandidateKeys(): ReadonlySet<string> {
  const expected = new Set<string>();
  for (const focus of FOCUSES) {
    for (const strategy of STRATEGIES) {
      for (const xpBudget of XP_BUDGETS) {
        for (const equipment of EQUIPMENT) {
          for (const party of PARTIES) {
            expected.add(candidateKey(focus, strategy, xpBudget, equipment, party));
          }
        }
      }
    }
  }
  return expected;
}

function depthsAreNull(depths: Depths): boolean {
  return STAGE_CAPS.every((stage) => depths[String(stage) as `${StageCap}`] === null);
}

function depthsAreValid(depths: Depths): boolean {
  return STAGE_CAPS.every((stage) => {
    const depth = depths[String(stage) as `${StageCap}`];
    return depth !== null && Number.isSafeInteger(depth) && depth >= 0 && depth <= stage;
  });
}

export function validateCandidateRows(rows: readonly CandidateRow[]): void {
  const expected = expectedCandidateKeys();
  const keys = rows.map((row) =>
    candidateKey(row.focus, row.strategy, row.xpBudget, row.equipment, row.party)
  );
  if (
    rows.length !== expected.size ||
    new Set(rows.map((row) => row.key)).size !== expected.size ||
    new Set(keys).size !== expected.size ||
    rows.some((row, index) => row.key !== keys[index] || !expected.has(row.key))
  ) {
    throw new Error("incomplete_candidate_progression_matrix");
  }
  for (const row of rows) {
    const shouldBeUnsupported = row.ring.kind === "healing" && row.ring.color !== "blue";
    if (shouldBeUnsupported) {
      if (
        row.supported ||
        !depthsAreNull(row.fittingDepth) ||
        !depthsAreNull(row.neutralDepth) ||
        !depthsAreNull(row.failureDepth)
      ) {
        throw new Error("invalid_unsupported_candidate_depth");
      }
      continue;
    }
    if (
      !row.supported ||
      !depthsAreValid(row.fittingDepth) ||
      !depthsAreValid(row.neutralDepth) ||
      !depthsAreValid(row.failureDepth)
    ) {
      throw new Error("invalid_supported_candidate_depth");
    }
  }
}

function candidateRows(): readonly CandidateRow[] {
  const rows: CandidateRow[] = [];
  for (const focus of FOCUSES) {
    for (const strategy of STRATEGIES) {
      for (const xpBudget of XP_BUDGETS) {
        for (const equipment of EQUIPMENT) {
          for (const party of PARTIES) {
            rows.push(candidateRow(focus, strategy, xpBudget, equipment, party));
          }
        }
      }
    }
  }
  validateCandidateRows(rows);
  return rows;
}

function years(days: number): number {
  return Math.round(days / 365 * 100) / 100;
}

function ringMilestone(dailyXp: number): RingMilestone {
  const onePurpleDays = Math.ceil(PURPLE_RING_XP / dailyXp);
  const twoPurpleDays = Math.ceil(PURPLE_RING_XP * 2 / dailyXp);
  return {
    dailyXp,
    onePurpleDays,
    onePurpleYears: years(onePurpleDays),
    twoPurpleDays,
    twoPurpleYears: years(twoPurpleDays),
  };
}

function earnedXpDistribution(xpValues: readonly number[]): EarnedXpDistribution {
  const values = [...xpValues].sort((left, right) => left - right);
  if (values.length === 0) throw new Error("missing_current_v1_xp_samples");
  const quantile = (fraction: number): number =>
    values[Math.floor((values.length - 1) * fraction)]!;
  return {
    samples: values.length,
    min: values[0]!,
    p25: quantile(0.25),
    median: quantile(0.5),
    p75: quantile(0.75),
    max: values.at(-1)!,
    unique: [...new Set(values)],
  };
}

function purchaseCount(
  strategy: "focused_stat" | "balanced_stats",
  xpBudget: CandidateXpBudget,
): number {
  const allocation = allocate("physical", strategy, xpBudget);
  return Object.values(allocation.purchases).reduce((total, value) => total + value, 0);
}

export async function generateCoupledProgressionReport(): Promise<
  CoupledProgressionReport
> {
  const currentReports = await simulateStarterBuildMatrix();
  const survivalReports = await simulateSurvivalAwareStarterMatrix();
  const observedXp = earnedXpDistribution(
    [...currentReports, ...survivalReports].map((report) => report.xp),
  );
  const focusedStatCapXp = cumulativeStatCost(CANDIDATE_V2_CURVES, 30);
  const reportWithoutHash = {
    version: "coupled-progression-matrix-v1",
    provenance: {
      currentV1: "resolver-v1+fallback-day-01+starter-matrix",
      candidateV2: "adr-076+game-design-v1.1+aggregate-party",
      healingUnsupported: "missing-higher-color-healing-output",
    },
    coverage: {
      unsupported: [
        "healing:green",
        "healing:yellow",
        "healing:purple",
      ],
    },
    currentV1: {
      reportCount: currentReports.length + survivalReports.length,
      dominancePairs: pairwiseDominancePairs(currentReports),
      baselineDominancePairs: baselineRingDominancePairs(currentReports),
      earnedXp: observedXp,
    },
    candidateV2: { rows: candidateRows() },
    economy: {
      observedDailyXp: [observedXp.median, observedXp.p75, observedXp.max],
      scenarioDailyXp: [90, 150],
      ringMilestones: [
        observedXp.median,
        observedXp.p75,
        observedXp.max,
        90,
        150,
      ].map(ringMilestone),
      focusedStatCapXp,
      balancedFourStatCapXp: focusedStatCapXp * 4,
      early43: {
        focusedPurchases: purchaseCount("focused_stat", 43),
        balancedPurchases: purchaseCount("balanced_stats", 43),
      },
    },
    sessionLoad: STAGE_CAPS.map((stages) => ({
      stages,
      decisions: stages + 1,
      maximumWithOneOffer: stages + 2,
    })),
    recommendation: "keep-10-until-healing-v2-content-and-owner-session-evidence",
  } as const;
  return {
    ...reportWithoutHash,
    reportHash: await sha256Hex(canonicalJson(reportWithoutHash)),
  };
}

if (import.meta.main) {
  console.log(canonicalJson(await generateCoupledProgressionReport()));
}
