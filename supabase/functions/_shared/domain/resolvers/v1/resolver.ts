import type { ChoiceV1, DungeonContentV1, StageV1, Stat } from "../../../contracts/content.ts";
import type {
  AggregatedParty,
  ChoiceCommandV1,
  Outcome,
  PartySnapshot,
  ResolutionV1,
  RunStateV1,
} from "../../../contracts/domain.ts";
import { assertDungeonContentV1 } from "../../content-validator.ts";
import { applyHeal, mitigateDamage, resolveCombatExchange } from "./combat.ts";
import { CONFIG_V1 } from "./config.ts";
import { aggregateParty } from "./party.ts";

export interface ResolveChoiceV1Input {
  readonly content: DungeonContentV1;
  readonly party: PartySnapshot;
  readonly state: RunStateV1;
  readonly command: ChoiceCommandV1;
}

function getStage(content: DungeonContentV1, stageNumber: number): StageV1 {
  const stage = content.stages[stageNumber - 1];
  if (!stage || stage.number !== stageNumber) throw new Error(`Missing stage ${stageNumber}`);
  return stage;
}

function getChoice(stage: StageV1, command: ChoiceCommandV1): ChoiceV1 {
  const choices = command.stage === 10
    ? stage.bossExchanges?.[Number(command.exchange) - 1]?.choices
    : stage.choices;
  const choice = choices?.find((candidate) => candidate.id === command.choiceId);
  if (!choice) throw new Error(`Unknown choice ${command.choiceId}`);
  return choice;
}

function checkDetails(
  choice: ChoiceV1,
  stageNumber: number,
  party: AggregatedParty,
): ResolutionV1["check"] {
  if (choice.kind !== "check" || !choice.stat || !choice.tier || !choice.tacticalModifier) {
    return null;
  }
  const stat: Stat = choice.stat;
  const selfPower = party.breakdown.self[stat];
  const totalPower = party.total[stat];
  const companionPower = totalPower - selfPower;
  const threshold = CONFIG_V1.stageThresholds[stageNumber - 1] +
    CONFIG_V1.tierDelta[choice.tier] +
    CONFIG_V1.tacticalBandDelta[choice.tacticalModifier];
  return { stat, selfPower, companionPower, totalPower, threshold };
}

function choiceOutcome(choice: ChoiceV1, check: ResolutionV1["check"]): Outcome {
  if (choice.kind === "neutral") return "neutral";
  if (choice.kind === "trap") return "failure";
  return check && check.totalPower >= check.threshold ? "success" : "failure";
}

function xpDelta(stageNumber: number, outcome: Outcome, available: number): number {
  const full = CONFIG_V1.stageXp[stageNumber - 1];
  const requested = outcome === "success"
    ? full
    : outcome === "neutral"
    ? Math.floor(full * CONFIG_V1.neutralXpPercent / 100)
    : 0;
  return Math.max(0, Math.min(requested, available));
}

function clueFor(stage: StageV1, choice: ChoiceV1): { id: string; text: string } {
  const clue = stage.clues.find((candidate) => candidate.id === choice.clueId);
  if (!clue) throw new Error(`Choice ${choice.id} references missing clue ${choice.clueId}`);
  return clue;
}

function resolveOrdinary(
  stage: StageV1,
  party: AggregatedParty,
  state: RunStateV1,
  command: ChoiceCommandV1,
): ResolutionV1 {
  if (command.exchange !== null || state.exchange !== null || state.bossHp !== null) {
    throw new Error("Ordinary stage cannot carry boss exchange state");
  }
  const choice = getChoice(stage, command);
  const check = checkDetails(choice, command.stage, party);
  const outcome = choiceOutcome(choice, check);
  const rawDamage = outcome === "success"
    ? CONFIG_V1.successDamage[command.stage - 1]
    : outcome === "neutral"
    ? CONFIG_V1.neutralDamage[command.stage - 1]
    : CONFIG_V1.failureDamage[command.stage - 1];
  const damage = mitigateDamage(rawDamage, party.total.defense, CONFIG_V1.defenseScale);
  const damagedHp = Math.max(0, state.hp - damage);
  const after = applyHeal(damagedHp, party.total.maxHp, party.support.postHeal);
  const postHeal = after - damagedHp;
  const availableXp = CONFIG_V1.dailyXpCap - state.xp;
  const delta = xpDelta(command.stage, outcome, availableXp);
  const terminal = after === 0 ? "defeated" : null;
  return {
    resolverVersion: "v1",
    stage: command.stage,
    exchange: null,
    choiceId: choice.id,
    outcome,
    clue: clueFor(stage, choice),
    rationale: choice.rationale,
    check,
    hp: { before: state.hp, damage, vampHeal: 0, postHeal, after },
    bossHp: null,
    xp: { before: state.xp, delta, after: state.xp + delta },
    terminal,
    nextStage: terminal ? null : command.stage + 1,
    nextExchange: null,
  };
}

function bossIncomingDamage(choice: ChoiceV1, outcome: Outcome, exchangeIndex: 0 | 1): number {
  const base = CONFIG_V1.bossDamage[exchangeIndex];
  if (outcome === "failure") {
    return Math.floor(base * CONFIG_V1.bossFailureIncomingPercent / 100);
  }
  if (outcome === "success" && choice.tacticalModifier === "counter") {
    return Math.floor(base * CONFIG_V1.bossCounterIncomingPercent / 100);
  }
  return base;
}

function resolveBoss(
  stage: StageV1,
  party: AggregatedParty,
  state: RunStateV1,
  command: ChoiceCommandV1,
): ResolutionV1 {
  if (command.exchange !== 1 && command.exchange !== 2) {
    throw new Error("Boss command must identify exchange 1 or 2");
  }
  const exchangeIndex = command.exchange - 1 as 0 | 1;
  if (command.exchange === 1) {
    if (state.exchange !== null || state.bossHp !== null) {
      throw new Error("Boss exchange 1 must start from full configured boss HP");
    }
  } else if (state.exchange !== 2 || state.bossHp === null || state.bossHp <= 0) {
    throw new Error("Boss exchange 2 requires a live carried boss state");
  }

  const choice = getChoice(stage, command);
  const check = checkDetails(choice, command.stage, party);
  const outcome = choiceOutcome(choice, check);
  const bossHpBefore = command.exchange === 1 ? CONFIG_V1.bossMaxHp : state.bossHp!;
  const fullOwnerDamage = CONFIG_V1.bossOwnerDamage[exchangeIndex];
  const ownerDamage = outcome === "success"
    ? fullOwnerDamage
    : outcome === "neutral"
    ? Math.floor(fullOwnerDamage * CONFIG_V1.bossNeutralDamagePercent / 100)
    : 0;
  const combat = resolveCombatExchange({
    hp: state.hp,
    maxHp: party.total.maxHp,
    bossHp: bossHpBefore,
    ownerDamage,
    incomingDamage: bossIncomingDamage(choice, outcome, exchangeIndex),
    defense: party.total.defense,
    defenseScale: CONFIG_V1.defenseScale,
    vampRateBps: party.support.vampRateBps,
    vampStageCapBps: CONFIG_V1.vampStageCapBps,
    vampRunCapBps: CONFIG_V1.vampRunCapBps,
    vampHealedStage: state.vampHealedStage,
    vampHealedRun: state.vampHealedRun,
    postHeal: party.support.postHeal,
  });

  let terminal: ResolutionV1["terminal"] = null;
  let nextExchange: 2 | null = null;
  if (command.exchange === 1) {
    if (combat.hp === 0) terminal = "defeated";
    else nextExchange = 2;
  } else if (combat.bossHp === 0) terminal = "victory";
  else if (combat.hp === 0) terminal = "defeated";
  else terminal = "contained";

  const requestedOutcome: Outcome = terminal === "victory"
    ? "success"
    : terminal === "contained"
    ? "neutral"
    : "failure";
  const delta = command.exchange === 2
    ? xpDelta(10, requestedOutcome, CONFIG_V1.dailyXpCap - state.xp)
    : 0;
  return {
    resolverVersion: "v1",
    stage: 10,
    exchange: command.exchange,
    choiceId: choice.id,
    outcome,
    clue: clueFor(stage, choice),
    rationale: choice.rationale,
    check,
    hp: {
      before: state.hp,
      damage: combat.incomingDamage,
      vampHeal: combat.vampHeal,
      postHeal: combat.postHeal,
      after: combat.hp,
    },
    bossHp: {
      before: bossHpBefore,
      ownerDamage: combat.actualOwnerDamage,
      after: combat.bossHp,
    },
    xp: { before: state.xp, delta, after: state.xp + delta },
    terminal,
    nextStage: null,
    nextExchange,
  };
}

export function resolveChoiceV1(input: ResolveChoiceV1Input): ResolutionV1 {
  assertDungeonContentV1(input.content);
  const { state, command } = input;
  if (command.resolverVersion !== "v1") throw new Error("V1 resolver requires resolverVersion v1");
  if (state.terminal !== null) throw new Error("Cannot resolve a terminal run");
  if (state.stage !== command.stage) throw new Error("Command stage does not match run state");
  const stage = getStage(input.content, command.stage);
  const party = aggregateParty(input.party);
  if (state.hp <= 0) throw new Error("Nonterminal run must have positive HP");
  if (state.hp > party.total.maxHp) {
    throw new Error("Run HP is outside party bounds");
  }
  if (state.xp < 0 || state.xp > CONFIG_V1.dailyXpCap) {
    throw new Error(`Run XP must be between 0 and ${CONFIG_V1.dailyXpCap}`);
  }
  if (state.bossHp !== null && state.bossHp > CONFIG_V1.bossMaxHp) {
    throw new Error("Carried boss HP is outside configured bounds");
  }
  return command.stage === 10
    ? resolveBoss(stage, party, state, command)
    : resolveOrdinary(stage, party, state, command);
}

export function advanceStateV1(state: RunStateV1, resolution: ResolutionV1): RunStateV1 {
  const remainsOnStage = resolution.nextExchange === 2;
  return {
    stage: resolution.nextStage ?? resolution.stage,
    exchange: resolution.nextExchange,
    hp: resolution.hp.after,
    bossHp: remainsOnStage ? resolution.bossHp?.after ?? null : null,
    xp: resolution.xp.after,
    vampHealedStage: remainsOnStage ? state.vampHealedStage + resolution.hp.vampHeal : 0,
    vampHealedRun: state.vampHealedRun + resolution.hp.vampHeal,
    terminal: resolution.terminal,
  };
}
