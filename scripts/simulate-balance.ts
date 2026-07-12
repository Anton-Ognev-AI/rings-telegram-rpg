import fallback from "../content/fallback/case-001/day-01.json" with { type: "json" };
import type {
  ChoiceV1,
  DungeonContentV1,
} from "../supabase/functions/_shared/contracts/content.ts";
import type {
  ChoiceCommandV1,
  PartySnapshot,
  ResolutionV1,
  RunStateV1,
  TerminalResult,
} from "../supabase/functions/_shared/contracts/domain.ts";
import { canonicalJson, sha256Hex } from "../supabase/functions/_shared/domain/canonical-json.ts";
import { resolveAndHash } from "../supabase/functions/_shared/domain/resolver-registry.ts";
import { advanceStateV1 } from "../supabase/functions/_shared/domain/resolvers/v1/resolver.ts";
import { aggregateParty } from "../supabase/functions/_shared/domain/resolvers/v1/party.ts";

export interface SimulationBuild {
  readonly name: string;
  readonly party: PartySnapshot;
}

export interface SimulationReport {
  readonly build: string;
  readonly policy: "recommended-checks";
  readonly lastCompletedStage: number;
  readonly terminal: TerminalResult | null;
  readonly remainingHp: number;
  readonly xp: number;
  readonly replayHash: string;
}

export const EARLY_TEACHER_BUILD: SimulationBuild = {
  name: "early-teacher",
  party: {
    mode: "tutorial",
    self: {
      maxHp: 20,
      physical: 5,
      magical: 5,
      agility: 5,
      vitality: 5,
      defense: 2,
      vampRateBps: 0,
      postHeal: 0,
    },
    companion: { maxHp: 15, physical: 4, magical: 4, agility: 4, defense: 2 },
  },
};

export const DEVELOPED_SOLO_BUILD: SimulationBuild = {
  name: "developed-solo",
  party: {
    mode: "solo",
    self: {
      maxHp: 100,
      physical: 70,
      magical: 70,
      agility: 70,
      vitality: 70,
      defense: 0,
      vampRateBps: 0,
      postHeal: 0,
    },
    companion: null,
  },
};

function choicesFor(content: DungeonContentV1, state: RunStateV1): readonly ChoiceV1[] {
  const stage = content.stages[state.stage - 1];
  if (!stage) throw new Error(`Simulation is missing stage ${state.stage}`);
  if (state.stage < 10) return stage.choices ?? [];
  const exchange = state.exchange ?? 1;
  return stage.bossExchanges?.[exchange - 1]?.choices ?? [];
}

function recommendedChoice(choices: readonly ChoiceV1[]): ChoiceV1 {
  const counter = choices.find((choice) =>
    choice.kind === "check" && choice.tacticalModifier === "counter"
  );
  if (counter) return counter;
  const standard = choices.find((choice) => choice.kind === "check");
  if (standard) return standard;
  const neutral = choices.find((choice) => choice.kind === "neutral");
  if (!neutral) throw new Error("Simulation stage has no supported choice");
  return neutral;
}

export async function simulateBuild(
  build: SimulationBuild,
  policy: "recommended-checks",
): Promise<SimulationReport> {
  const content = fallback as unknown as DungeonContentV1;
  let state: RunStateV1 = {
    stage: 1,
    exchange: null,
    hp: aggregateParty(build.party).total.maxHp,
    bossHp: null,
    xp: 0,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  let lastCompletedStage = 0;
  const resolutions: ResolutionV1[] = [];

  while (state.terminal === null && state.stage <= 10) {
    const choice = recommendedChoice(choicesFor(content, state));
    const command: ChoiceCommandV1 = {
      resolverVersion: "v1",
      stage: state.stage,
      exchange: state.stage === 10 ? state.exchange ?? 1 : null,
      choiceId: choice.id,
    };
    const replay = await resolveAndHash({ content, party: build.party, state, command });
    resolutions.push(replay.resolution);
    if (replay.resolution.terminal === "defeated") {
      lastCompletedStage = Math.max(lastCompletedStage, replay.resolution.stage - 1);
    } else {
      lastCompletedStage = Math.max(lastCompletedStage, replay.resolution.stage);
    }
    state = advanceStateV1(state, replay.resolution);
  }

  const reportWithoutHash = {
    build: build.name,
    policy,
    lastCompletedStage,
    terminal: state.terminal,
    remainingHp: state.hp,
    xp: state.xp,
  };
  return {
    ...reportWithoutHash,
    replayHash: await sha256Hex(canonicalJson({ resolutions, finalState: state })),
  };
}

if (import.meta.main) {
  const reports = await Promise.all([
    simulateBuild(EARLY_TEACHER_BUILD, "recommended-checks"),
    simulateBuild(DEVELOPED_SOLO_BUILD, "recommended-checks"),
  ]);
  console.log(canonicalJson(reports));
}
