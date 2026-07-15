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
import { resolveAndHash } from "../supabase/functions/_shared/domain/resolver-registry.ts";
import { aggregateParty } from "../supabase/functions/_shared/domain/resolvers/v1/party.ts";
import { advanceStateV1 } from "../supabase/functions/_shared/domain/resolvers/v1/resolver.ts";

export type StarterRing = "weapon" | "fire" | "defense" | "healing";
export type StarterPolicy = "correct" | "mixed" | "attrition";
export type StarterPartyMode = "tutorial" | "ordinary";

export interface StarterSimulationReport {
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
const policies: readonly StarterPolicy[] = ["correct", "mixed", "attrition"];
const partyModes: readonly StarterPartyMode[] = ["tutorial", "ordinary"];

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

function choicesFor(state: RunStateV1): readonly ChoiceV1[] {
  const stage = content.stages[state.stage - 1];
  if (!stage) throw new Error(`missing_simulation_stage:${state.stage}`);
  return state.stage === 10
    ? stage.bossExchanges?.[(state.exchange ?? 1) - 1]?.choices ?? []
    : stage.choices ?? [];
}

function correctChoice(choices: readonly ChoiceV1[]): ChoiceV1 {
  const choice =
    choices.find((candidate) =>
      candidate.kind === "check" && candidate.tacticalModifier === "counter"
    ) ?? choices.find((candidate) => candidate.kind === "check") ??
      choices.find((candidate) => candidate.kind === "neutral");
  if (!choice) throw new Error("missing_correct_policy_choice");
  return choice;
}

function choose(
  choices: readonly ChoiceV1[],
  policy: StarterPolicy,
  resolutionIndex: number,
): ChoiceV1 {
  if (policy === "correct") return correctChoice(choices);
  const neutral = choices.find((candidate) => candidate.kind === "neutral");
  if (policy === "attrition") {
    const choice = neutral ?? choices.find((candidate) => candidate.kind === "trap") ??
      choices.at(-1);
    if (!choice) throw new Error("missing_attrition_policy_choice");
    return choice;
  }
  if (resolutionIndex % 2 === 0) return correctChoice(choices);
  const correct = correctChoice(choices);
  return choices.find((candidate) => candidate.id !== correct.id && candidate.kind === "check") ??
    neutral ?? correct;
}

function emptySuccessfulChecks(): Record<Stat, number> {
  return { physical: 0, magical: 0, agility: 0, vitality: 0 };
}

async function simulate(
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
    const selected = choose(choicesFor(state), policy, resolutions.length);
    const command: ChoiceCommandV1 = {
      resolverVersion: "v1",
      stage: state.stage,
      exchange: state.stage === 10 ? state.exchange ?? 1 : null,
      choiceId: selected.id,
    };
    const replay = await resolveAndHash({ content, party: snapshot, state, command });
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

export async function simulateStarterBuildMatrix(): Promise<readonly StarterSimulationReport[]> {
  const reports: StarterSimulationReport[] = [];
  for (const partyMode of partyModes) {
    for (const policy of policies) {
      for (const ring of rings) reports.push(await simulate(ring, policy, partyMode));
    }
  }
  return reports;
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

export function strictlyDominatingRings(
  reports: readonly StarterSimulationReport[],
): readonly StarterRing[] {
  const byKey = new Map(
    reports.map((report) => [`${report.ring}:${report.partyMode}:${report.policy}`, report]),
  );
  return rings.filter((candidateRing) =>
    rings.filter((otherRing) => otherRing !== candidateRing).every((otherRing) => {
      let anyStrict = false;
      for (const partyMode of partyModes) {
        for (const policy of policies) {
          const candidate = byKey.get(`${candidateRing}:${partyMode}:${policy}`);
          const other = byKey.get(`${otherRing}:${partyMode}:${policy}`);
          if (!candidate || !other) throw new Error("incomplete_starter_balance_matrix");
          const comparison = dominates(candidate, other);
          if (!comparison.noWorse) return false;
          anyStrict ||= comparison.strictlyBetter;
        }
      }
      return anyStrict;
    })
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
  assertNoStrictRingDominance(reports);
  console.log(canonicalJson(reports));
}
