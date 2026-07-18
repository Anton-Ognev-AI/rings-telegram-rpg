import fallbackJson from "../content/fallback/case-001/day-01.json" with { type: "json" };
import type {
  ChoiceV1,
  DungeonContentV1,
  Stat,
} from "../supabase/functions/_shared/contracts/content.ts";
import type {
  ChoiceCommandV1,
  PartySnapshot,
  ResolutionV1,
  RunStateV1,
  SelfSnapshot,
  TerminalResult,
} from "../supabase/functions/_shared/contracts/domain.ts";
import { canonicalJson, sha256Hex } from "../supabase/functions/_shared/domain/canonical-json.ts";
import { validateDungeonContentV1 } from "../supabase/functions/_shared/domain/content-validator.ts";
import { resolveAndHash } from "../supabase/functions/_shared/domain/resolver-registry.ts";
import { aggregateParty } from "../supabase/functions/_shared/domain/resolvers/v1/party.ts";
import { CONFIG_V1 } from "../supabase/functions/_shared/domain/resolvers/v1/config.ts";
import { advanceStateV1 } from "../supabase/functions/_shared/domain/resolvers/v1/resolver.ts";

export type StarterRing = "weapon" | "fire" | "defense" | "healing";
export type StarterPolicy = "correct" | "mixed" | "attrition" | "survival_aware";
export type StarterPartyMode = "tutorial" | "ordinary";
export type StarterArchetype = "baseline" | "martial" | "arcane";

export interface StarterSimulationReport {
  readonly archetype: StarterArchetype;
  readonly ring: StarterRing;
  readonly policy: StarterPolicy;
  readonly partyMode: StarterPartyMode;
  readonly lastCompletedStage: number;
  readonly terminal: TerminalResult | null;
  readonly remainingHp: number;
  readonly xp: number;
  readonly successfulChecks: Readonly<Record<Stat, number>>;
  readonly replayHash: string;
}

const content = fallbackJson as DungeonContentV1;
const rings: readonly StarterRing[] = ["weapon", "fire", "defense", "healing"];
const balancePolicies: readonly StarterPolicy[] = ["correct", "mixed", "attrition"];
const partyModes: readonly StarterPartyMode[] = ["tutorial", "ordinary"];
const archetypes: readonly StarterArchetype[] = ["baseline", "martial", "arcane"];

function projectedStat(
  stat: Stat | undefined,
  archetype: StarterArchetype,
): Stat | undefined {
  if (archetype === "martial" && stat === "magical") return "physical";
  if (archetype === "arcane" && stat === "physical") return "magical";
  return stat;
}

function projectChoice(choice: ChoiceV1, archetype: StarterArchetype): ChoiceV1 {
  return choice.kind === "check"
    ? { ...choice, stat: projectedStat(choice.stat, archetype) }
    : { ...choice };
}

function projectContent(
  sourceContent: DungeonContentV1,
  archetype: StarterArchetype,
): DungeonContentV1 {
  const cloned = structuredClone(sourceContent);
  const projected: DungeonContentV1 = archetype === "baseline" ? sourceContent : {
    ...cloned,
    stages: cloned.stages.map((stage) => ({
      ...stage,
      ...(stage.choices
        ? { choices: stage.choices.map((choice) => projectChoice(choice, archetype)) }
        : {}),
      ...(stage.bossExchanges
        ? {
          bossExchanges: stage.bossExchanges.map((exchange) => ({
            ...exchange,
            choices: exchange.choices.map((choice) => projectChoice(choice, archetype)),
          })),
        }
        : {}),
    })),
  };
  const validation = validateDungeonContentV1(projected);
  if (!validation.ok) {
    throw new Error(
      `invalid_starter_archetype:${archetype}:${validation.errors.join("|")}`,
    );
  }
  return projected;
}

function ringSelf(ring: StarterRing): SelfSnapshot {
  const base: SelfSnapshot = {
    maxHp: 40,
    physical: 5,
    magical: 5,
    agility: 5,
    vitality: 5,
    defense: 5,
    vampRateBps: 0,
    postHeal: 0,
  };
  if (ring === "weapon") {
    return { ...base, physical: Math.floor((base.physical + 1 + 2) * 1.15), defense: 7 };
  }
  if (ring === "fire") {
    return { ...base, magical: Math.floor((base.magical + 1 + 2) * 1.15), defense: 7 };
  }
  if (ring === "defense") {
    return {
      ...base,
      physical: base.physical + 2,
      agility: base.agility + 1,
      defense: Math.floor((base.defense + 2) * 1.15),
    };
  }
  return {
    ...base,
    maxHp: base.maxHp + 4 + 4,
    physical: base.physical + 2,
    vitality: base.vitality + 1,
    postHeal: 1,
  };
}

function party(ring: StarterRing, mode: StarterPartyMode): PartySnapshot {
  const self = ringSelf(ring);
  if (mode === "tutorial") {
    return {
      mode: "tutorial",
      self,
      companion: { maxHp: 5, physical: 4, magical: 4, agility: 4, defense: 2 },
    };
  }
  return { mode: "solo", self, companion: null };
}

function choicesFor(
  scenarioContent: DungeonContentV1,
  state: RunStateV1,
): readonly ChoiceV1[] {
  const stage = scenarioContent.stages[state.stage - 1];
  if (!stage) throw new Error(`missing_simulation_stage:${state.stage}`);
  return state.stage === 10
    ? stage.bossExchanges?.[(state.exchange ?? 1) - 1]?.choices ?? []
    : stage.choices ?? [];
}

export function scoreInformedCheckChoice(
  choice: ChoiceV1,
  snapshot: PartySnapshot,
  stageNumber: number,
): number | null {
  if (choice.kind !== "check" || !choice.stat || !choice.tier || !choice.tacticalModifier) {
    return null;
  }
  const stageThreshold = CONFIG_V1.stageThresholds[stageNumber - 1];
  if (stageThreshold === undefined) throw new Error(`invalid_informed_stage:${stageNumber}`);
  const threshold = stageThreshold + CONFIG_V1.tierDelta[choice.tier] +
    CONFIG_V1.tacticalBandDelta[choice.tacticalModifier];
  return aggregateParty(snapshot).total[choice.stat] - threshold;
}

export function selectInformedChoice(
  choices: readonly ChoiceV1[],
  snapshot: PartySnapshot,
  stageNumber: number,
  excludedChoiceId?: string,
): ChoiceV1 {
  const rankedChecks = choices.flatMap((choice, index) => {
    if (choice.id === excludedChoiceId) return [];
    const margin = scoreInformedCheckChoice(choice, snapshot, stageNumber);
    return margin === null ? [] : [{ choice, index, margin }];
  }).sort((left, right) => right.margin - left.margin || left.index - right.index);
  const choice = rankedChecks[0]?.choice ??
    choices.find((candidate) => candidate.kind === "neutral");
  if (!choice) throw new Error("missing_correct_policy_choice");
  return choice;
}

export function selectSurvivalAwareChoice(
  choices: readonly ChoiceV1[],
  snapshot: PartySnapshot,
  stageNumber: number,
): ChoiceV1 {
  const informed = selectInformedChoice(choices, snapshot, stageNumber);
  const margin = scoreInformedCheckChoice(informed, snapshot, stageNumber);
  if (margin !== null && margin >= 0) return informed;
  return choices.find((candidate) => candidate.kind === "neutral") ?? informed;
}

function choose(
  choices: readonly ChoiceV1[],
  policy: StarterPolicy,
  resolutionIndex: number,
  snapshot: PartySnapshot,
  stageNumber: number,
): ChoiceV1 {
  if (policy === "correct") return selectInformedChoice(choices, snapshot, stageNumber);
  if (policy === "survival_aware") {
    return selectSurvivalAwareChoice(choices, snapshot, stageNumber);
  }
  const neutral = choices.find((candidate) => candidate.kind === "neutral");
  if (policy === "attrition") {
    const choice = neutral ?? choices.find((candidate) => candidate.kind === "trap") ??
      choices.at(-1);
    if (!choice) throw new Error("missing_attrition_policy_choice");
    return choice;
  }
  const correct = selectInformedChoice(choices, snapshot, stageNumber);
  if (resolutionIndex % 2 === 0) return correct;
  return selectInformedChoice(choices, snapshot, stageNumber, correct.id) ?? neutral ?? correct;
}

function emptySuccessfulChecks(): Record<Stat, number> {
  return { physical: 0, magical: 0, agility: 0, vitality: 0 };
}

async function simulate(
  scenarioContent: DungeonContentV1,
  archetype: StarterArchetype,
  ring: StarterRing,
  policy: StarterPolicy,
  partyMode: StarterPartyMode,
): Promise<StarterSimulationReport> {
  const snapshot = party(ring, partyMode);
  let state: RunStateV1 = {
    stage: 1,
    exchange: null,
    hp: aggregateParty(snapshot).total.maxHp,
    bossHp: null,
    xp: 0,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  let lastCompletedStage = 0;
  const resolutions: ResolutionV1[] = [];
  const successfulChecks = emptySuccessfulChecks();

  while (state.terminal === null && state.stage <= 10) {
    const selected = choose(
      choicesFor(scenarioContent, state),
      policy,
      resolutions.length,
      snapshot,
      state.stage,
    );
    const command: ChoiceCommandV1 = {
      resolverVersion: "v1",
      stage: state.stage,
      exchange: state.stage === 10 ? state.exchange ?? 1 : null,
      choiceId: selected.id,
    };
    const replay = await resolveAndHash({
      content: scenarioContent,
      party: snapshot,
      state,
      command,
    });
    const resolution = replay.resolution;
    resolutions.push(resolution);
    if (resolution.outcome === "success" && resolution.check) {
      successfulChecks[resolution.check.stat] += 1;
    }
    lastCompletedStage = resolution.terminal === "defeated"
      ? Math.max(lastCompletedStage, resolution.stage - 1)
      : Math.max(lastCompletedStage, resolution.stage);
    state = advanceStateV1(state, resolution);
  }

  return {
    archetype,
    ring,
    policy,
    partyMode,
    lastCompletedStage,
    terminal: state.terminal,
    remainingHp: state.hp,
    xp: state.xp,
    successfulChecks,
    replayHash: await sha256Hex(canonicalJson({ resolutions, finalState: state })),
  };
}

export async function simulateStarterBuildMatrixForContent(
  sourceContent: DungeonContentV1,
): Promise<readonly StarterSimulationReport[]> {
  const contentByArchetype = new Map(
    archetypes.map((archetype) =>
      [
        archetype,
        projectContent(sourceContent, archetype),
      ] as const
    ),
  );
  const reports: StarterSimulationReport[] = [];
  for (const archetype of archetypes) {
    const scenarioContent = contentByArchetype.get(archetype);
    if (!scenarioContent) throw new Error(`missing_starter_archetype:${archetype}`);
    for (const partyMode of partyModes) {
      for (const policy of balancePolicies) {
        for (const ring of rings) {
          reports.push(await simulate(scenarioContent, archetype, ring, policy, partyMode));
        }
      }
    }
  }
  return reports;
}

export async function simulateStarterBuildMatrix(): Promise<readonly StarterSimulationReport[]> {
  return await simulateStarterBuildMatrixForContent(content);
}

export async function simulateSurvivalAwareStarterMatrixForContent(
  sourceContent: DungeonContentV1,
): Promise<readonly StarterSimulationReport[]> {
  const contentByArchetype = new Map(
    archetypes.map((archetype) => [archetype, projectContent(sourceContent, archetype)] as const),
  );
  const reports: StarterSimulationReport[] = [];
  for (const archetype of archetypes) {
    const scenarioContent = contentByArchetype.get(archetype);
    if (!scenarioContent) throw new Error(`missing_starter_archetype:${archetype}`);
    for (const partyMode of partyModes) {
      for (const ring of rings) {
        reports.push(
          await simulate(scenarioContent, archetype, ring, "survival_aware", partyMode),
        );
      }
    }
  }
  return reports;
}

export async function simulateSurvivalAwareStarterMatrix(): Promise<
  readonly StarterSimulationReport[]
> {
  return await simulateSurvivalAwareStarterMatrixForContent(content);
}

function terminalScore(terminal: TerminalResult | null): number {
  if (terminal === "victory") return 3;
  if (terminal === "contained") return 2;
  if (terminal === null) return 1;
  return 0;
}

function successfulTotal(report: StarterSimulationReport): number {
  return Object.values(report.successfulChecks).reduce((total, value) => total + value, 0);
}

function dominates(
  candidate: StarterSimulationReport,
  other: StarterSimulationReport,
): { readonly noWorse: boolean; readonly strictlyBetter: boolean } {
  const candidateMetrics = [
    candidate.lastCompletedStage,
    terminalScore(candidate.terminal),
    candidate.remainingHp,
    candidate.xp,
    successfulTotal(candidate),
  ];
  const otherMetrics = [
    other.lastCompletedStage,
    terminalScore(other.terminal),
    other.remainingHp,
    other.xp,
    successfulTotal(other),
  ];
  return {
    noWorse: candidateMetrics.every((value, index) => value >= otherMetrics[index]!),
    strictlyBetter: candidateMetrics.some((value, index) => value > otherMetrics[index]!),
  };
}

function reportKeyFrom(
  archetype: StarterArchetype,
  partyMode: StarterPartyMode,
  policy: StarterPolicy,
  ring: StarterRing,
): string {
  return `${archetype}:${partyMode}:${policy}:${ring}`;
}

function reportKey(report: StarterSimulationReport): string {
  return reportKeyFrom(report.archetype, report.partyMode, report.policy, report.ring);
}

function validateBalanceMatrixForArchetypes(
  reports: readonly StarterSimulationReport[],
  expectedArchetypes: readonly StarterArchetype[],
): void {
  const expected = new Set<string>();
  for (const archetype of expectedArchetypes) {
    for (const partyMode of partyModes) {
      for (const policy of balancePolicies) {
        for (const ring of rings) {
          expected.add(reportKeyFrom(archetype, partyMode, policy, ring));
        }
      }
    }
  }
  const actual = reports.map(reportKey);
  if (
    reports.length !== expected.size ||
    new Set(actual).size !== expected.size ||
    reports.some((report) => report.terminal === null) ||
    actual.some((key) => !expected.has(key))
  ) {
    throw new Error("incomplete_starter_balance_matrix");
  }
}

export function validateStarterBalanceMatrix(
  reports: readonly StarterSimulationReport[],
): void {
  validateBalanceMatrixForArchetypes(reports, archetypes);
}

export interface RingDominancePair {
  readonly dominant: StarterRing;
  readonly dominated: StarterRing;
}

function dominancePairsForArchetypes(
  reports: readonly StarterSimulationReport[],
  expectedArchetypes: readonly StarterArchetype[],
): readonly RingDominancePair[] {
  validateBalanceMatrixForArchetypes(reports, expectedArchetypes);
  const byKey = new Map(reports.map((report) => [reportKey(report), report]));
  const pairs: RingDominancePair[] = [];
  for (const dominant of rings) {
    for (const dominated of rings) {
      if (dominant === dominated) continue;
      let anyStrict = false;
      let allNoWorse = true;
      for (const archetype of expectedArchetypes) {
        for (const partyMode of partyModes) {
          for (const policy of balancePolicies) {
            const candidate = byKey.get(
              reportKeyFrom(archetype, partyMode, policy, dominant),
            );
            const other = byKey.get(
              reportKeyFrom(archetype, partyMode, policy, dominated),
            );
            if (!candidate || !other) throw new Error("incomplete_starter_balance_matrix");
            const comparison = dominates(candidate, other);
            allNoWorse &&= comparison.noWorse;
            anyStrict ||= comparison.strictlyBetter;
          }
        }
      }
      if (allNoWorse && anyStrict) pairs.push({ dominant, dominated });
    }
  }
  return pairs;
}

export function pairwiseDominancePairs(
  reports: readonly StarterSimulationReport[],
): readonly RingDominancePair[] {
  return dominancePairsForArchetypes(reports, archetypes);
}

export function baselineRingDominancePairs(
  reports: readonly StarterSimulationReport[],
): readonly RingDominancePair[] {
  return dominancePairsForArchetypes(
    reports.filter((report) => report.archetype === "baseline"),
    ["baseline"],
  );
}

export function assertNoPairwiseRingDominance(
  reports: readonly StarterSimulationReport[],
): void {
  const pairs = pairwiseDominancePairs(reports);
  if (pairs.length > 0) {
    throw new Error(
      `pairwise_starter_ring_dominance:${
        pairs.map((pair) => `${pair.dominant}>${pair.dominated}`).join(",")
      }`,
    );
  }
}

export function strictlyDominatingRings(
  reports: readonly StarterSimulationReport[],
): readonly StarterRing[] {
  const pairs = pairwiseDominancePairs(reports);
  return rings.filter((candidate) =>
    rings.every((other) =>
      candidate === other ||
      pairs.some((pair) => pair.dominant === candidate && pair.dominated === other)
    )
  );
}

export function assertNoStrictRingDominance(
  reports: readonly StarterSimulationReport[],
): void {
  const dominant = strictlyDominatingRings(reports);
  if (dominant.length > 0) throw new Error(`strict_starter_ring_dominance:${dominant.join(",")}`);
}

if (import.meta.main) {
  const reports = await simulateStarterBuildMatrix();
  const survivalAwareReports = await simulateSurvivalAwareStarterMatrix();
  const dominancePairs = pairwiseDominancePairs(reports);
  assertNoPairwiseRingDominance(reports);
  const baselineDominancePairs = baselineRingDominancePairs(reports);
  console.log(
    canonicalJson({ reports, survivalAwareReports, dominancePairs, baselineDominancePairs }),
  );
}
