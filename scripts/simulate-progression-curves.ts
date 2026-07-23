import { mitigateDamage } from "../supabase/functions/_shared/domain/resolvers/v1/combat.ts";
import { CONFIG_V1 } from "../supabase/functions/_shared/domain/resolvers/v1/config.ts";

type FixedCurve = {
  readonly kind: "fixed";
  readonly values: readonly number[];
};

type GeometricCurve = {
  readonly kind: "geometric";
  readonly base: number;
  readonly multiplier: number;
};

type StageCurve = FixedCurve | GeometricCurve;

type PrototypeStatCost = {
  readonly kind: "prototype";
  readonly base: number;
  readonly linear: number;
  readonly quadratic: number;
};

type GeometricStatCost = {
  readonly kind: "geometric";
  readonly base: number;
  readonly multiplier: number;
};

export interface ProgressionCurveModel {
  readonly id: "baseline-v1" | "candidate-v2";
  readonly statCost: PrototypeStatCost | GeometricStatCost;
  readonly threshold: StageCurve;
  readonly neutralDamage: StageCurve;
  readonly failureDamage: StageCurve;
  readonly defenseScale: number;
}

export const BASELINE_V1_CURVES: ProgressionCurveModel = Object.freeze(
  {
    id: "baseline-v1",
    statCost: { kind: "prototype", base: 20, linear: 6, quadratic: 2 },
    threshold: { kind: "fixed", values: CONFIG_V1.stageThresholds },
    neutralDamage: { kind: "fixed", values: CONFIG_V1.neutralDamage.slice(0, 9) },
    failureDamage: { kind: "fixed", values: CONFIG_V1.failureDamage.slice(0, 9) },
    defenseScale: CONFIG_V1.defenseScale,
  } as const satisfies ProgressionCurveModel,
);

export const CANDIDATE_V2_CURVES: ProgressionCurveModel = Object.freeze(
  {
    id: "candidate-v2",
    statCost: { kind: "geometric", base: 20, multiplier: 1.2 },
    threshold: { kind: "geometric", base: 5, multiplier: 1.35 },
    neutralDamage: { kind: "geometric", base: 5, multiplier: 1.32 },
    failureDamage: { kind: "geometric", base: 6, multiplier: 1.4 },
    defenseScale: CONFIG_V1.defenseScale,
  } as const satisfies ProgressionCurveModel,
);

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid_${label}`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid_${label}`);
  return value;
}

export function prototypeMaxHp(vitality: number): number {
  const safeVitality = positiveInteger(vitality, "vitality");
  if (safeVitality < 5) throw new Error("prototype_vitality_below_starter");
  return 40 + (safeVitality - 5) * 4;
}

export function candidateMaxHp(vitality: number): number {
  return positiveInteger(vitality, "vitality") * 10;
}

export function projectedStatCost(model: ProgressionCurveModel, purchased: number): number {
  const safePurchased = nonNegativeInteger(purchased, "purchased_count");
  if (model.statCost.kind === "prototype") {
    return model.statCost.base + model.statCost.linear * safePurchased +
      model.statCost.quadratic * safePurchased * safePurchased;
  }
  return Math.ceil(model.statCost.base * model.statCost.multiplier ** safePurchased);
}

export function cumulativeStatCost(
  model: ProgressionCurveModel,
  purchases: number,
): number {
  const safePurchases = nonNegativeInteger(purchases, "purchases");
  let total = 0;
  for (let purchased = 0; purchased < safePurchases; purchased += 1) {
    total += projectedStatCost(model, purchased);
  }
  return total;
}

function stageValue(curve: StageCurve, stage: number): number {
  const safeStage = positiveInteger(stage, "stage");
  if (curve.kind === "fixed") {
    const value = curve.values[safeStage - 1];
    if (value === undefined) throw new Error(`fixed_curve_ends_at_${curve.values.length}`);
    return value;
  }
  return Math.ceil(curve.base * curve.multiplier ** (safeStage - 1));
}

export function stageCurve(
  model: ProgressionCurveModel,
  kind: "threshold" | "neutral" | "failure",
  stages: number,
): readonly number[] {
  const safeStages = nonNegativeInteger(stages, "stage_count");
  const curve = kind === "threshold"
    ? model.threshold
    : kind === "neutral"
    ? model.neutralDamage
    : model.failureDamage;
  return Array.from({ length: safeStages }, (_, index) => stageValue(curve, index + 1));
}

export function deepestPassingStage(
  model: ProgressionCurveModel,
  totalPower: number,
  thresholdModifier: number,
  maxStages: number,
): number {
  const safePower = nonNegativeInteger(totalPower, "total_power");
  if (!Number.isSafeInteger(thresholdModifier)) throw new Error("invalid_threshold_modifier");
  const thresholds = stageCurve(model, "threshold", maxStages);
  let deepest = 0;
  for (const [index, threshold] of thresholds.entries()) {
    if (safePower < Math.max(1, threshold + thresholdModifier)) break;
    deepest = index + 1;
  }
  return deepest;
}

export interface AttritionDepthInput {
  readonly hp: number;
  readonly defense: number;
  readonly outcome: "neutral" | "failure";
  readonly maxStages: number;
}

export interface AttritionDepthReport {
  readonly lastCompletedStage: number;
  readonly defeatedAtStage: number | null;
  readonly remainingHp: number;
}

export function simulateAttritionDepth(
  model: ProgressionCurveModel,
  input: AttritionDepthInput,
): AttritionDepthReport {
  let hp = positiveInteger(input.hp, "hp");
  const defense = nonNegativeInteger(input.defense, "defense");
  const damages = stageCurve(model, input.outcome, input.maxStages);
  let lastCompletedStage = 0;

  for (const [index, rawDamage] of damages.entries()) {
    hp = Math.max(0, hp - mitigateDamage(rawDamage, defense, model.defenseScale));
    if (hp === 0) {
      return {
        lastCompletedStage,
        defeatedAtStage: index + 1,
        remainingHp: 0,
      };
    }
    lastCompletedStage = index + 1;
  }

  return { lastCompletedStage, defeatedAtStage: null, remainingHp: hp };
}

if (import.meta.main) {
  const hpWithTeacher = candidateMaxHp(5) + 5;
  const report = {
    candidate: CANDIDATE_V2_CURVES,
    hp: { vitality5: candidateMaxHp(5), vitality6: candidateMaxHp(6) },
    firstTenStatCosts: Array.from(
      { length: 10 },
      (_, purchased) => projectedStatCost(CANDIDATE_V2_CURVES, purchased),
    ),
    cumulativeThirtyPurchases: cumulativeStatCost(CANDIDATE_V2_CURVES, 30),
    firstTwentyThresholds: stageCurve(CANDIDATE_V2_CURVES, "threshold", 20),
    starter: {
      fittingPower13: deepestPassingStage(CANDIDATE_V2_CURVES, 13, -3, 20),
      fittingPower25: deepestPassingStage(CANDIDATE_V2_CURVES, 25, -3, 20),
      neutral: simulateAttritionDepth(CANDIDATE_V2_CURVES, {
        hp: hpWithTeacher,
        defense: 6,
        outcome: "neutral",
        maxStages: 20,
      }),
      failure: simulateAttritionDepth(CANDIDATE_V2_CURVES, {
        hp: hpWithTeacher,
        defense: 6,
        outcome: "failure",
        maxStages: 20,
      }),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}
