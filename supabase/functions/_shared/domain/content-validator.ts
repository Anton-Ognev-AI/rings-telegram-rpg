import type {
  ChoiceKind,
  DungeonContentV1,
  EncounterType,
  StageRole,
  Stat,
} from "../contracts/content.ts";

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

const roles: readonly StageRole[] = [
  "entry",
  "clue",
  "application",
  "resistance",
  "miniboss",
  "counterplay",
  "escalation",
  "dilemma",
  "synthesis",
  "boss",
];
const encounters = new Set<EncounterType>([
  "exploration",
  "research",
  "social",
  "hazard",
  "pursuit",
  "combat",
]);
const stats = new Set<Stat>(["physical", "magical", "agility", "vitality"]);
const kinds = new Set<ChoiceKind>(["check", "neutral", "trap"]);
const tiers = new Set(["easy", "standard", "hard"]);
const modifiers = new Set(["counter", "standard", "against_telegraph"]);
const rootFields = new Set(["schemaVersion", "resolverVersion", "id", "title", "stages"]);
const stageFields = new Set([
  "number",
  "role",
  "encounterType",
  "scene",
  "important",
  "clues",
  "choices",
  "bossExchanges",
]);
const clueFields = new Set(["id", "text"]);
const choiceFields = new Set([
  "id",
  "label",
  "kind",
  "clueId",
  "rationale",
  "stat",
  "tier",
  "tacticalModifier",
  "copy",
]);
const copyFields = new Set(["success", "neutral", "failure"]);
const exchangeFields = new Set(["number", "scene", "choices"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rejectUnexpectedFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
  errors: string[],
): void {
  for (const key of Object.keys(record).sort()) {
    if (!allowed.has(key)) errors.push(`${context} has unexpected field ${key}`);
  }
}

export function validateDungeonContentV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["content must be an object"] };
  rejectUnexpectedFields(value, rootFields, "content", errors);
  if (value.schemaVersion !== "dungeon-v1") errors.push("schemaVersion must equal dungeon-v1");
  if (value.resolverVersion !== "v1") errors.push("resolverVersion must equal v1");
  if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(value.title)) errors.push("title must be a non-empty string");
  if (!Array.isArray(value.stages)) {
    return { ok: false, errors: [...errors, "stages must be an array"] };
  }

  const stages = value.stages;
  if (stages.length !== 10) errors.push("stages must contain exactly 10 entries");
  let combatCount = 0;
  let researchCount = 0;
  let socialCount = 0;
  let importantCount = 0;
  let trapCount = 0;
  let previousEncounter: string | null = null;
  const choiceIds = new Set<string>();

  for (let index = 0; index < stages.length; index++) {
    const stageNumber = index + 1;
    const stage = stages[index];
    if (!isRecord(stage)) {
      errors.push(`stage ${stageNumber} must be an object`);
      continue;
    }
    rejectUnexpectedFields(stage, stageFields, `stage ${stageNumber}`, errors);
    if (stage.number !== stageNumber) {
      errors.push(`stage ${stageNumber} must have number ${stageNumber}`);
    }
    if (stage.role !== roles[index]) {
      errors.push(`stage ${stageNumber} must have role ${roles[index]}`);
    }
    if (!encounters.has(stage.encounterType as EncounterType)) {
      errors.push(`stage ${stageNumber} has invalid encounterType`);
    }
    if (stage.encounterType === "combat") combatCount++;
    if (stage.encounterType === "research") researchCount++;
    if (stage.encounterType === "social") socialCount++;
    if (index > 0 && stage.encounterType === previousEncounter) {
      errors.push("adjacent stages must differ");
    }
    previousEncounter = typeof stage.encounterType === "string" ? stage.encounterType : null;
    if (stage.important === true) importantCount++;
    else if (stage.important !== false) {
      errors.push(`stage ${stageNumber} important must be boolean`);
    }
    if (!isNonEmptyString(stage.scene)) {
      errors.push(`stage ${stageNumber} scene must be a non-empty string`);
    } else if (stage.scene.length > 700) {
      errors.push(`stage ${stageNumber} scene must be at most 700 characters`);
    }

    const clueIds = new Set<string>();
    if (!Array.isArray(stage.clues) || stage.clues.length === 0) {
      errors.push(`stage ${stageNumber} must contain at least one clue`);
    } else {
      for (const clue of stage.clues) {
        if (!isRecord(clue) || !isNonEmptyString(clue.id) || !isNonEmptyString(clue.text)) {
          errors.push(`stage ${stageNumber} has invalid clue`);
          continue;
        }
        rejectUnexpectedFields(clue, clueFields, `stage ${stageNumber} clue`, errors);
        if (clueIds.has(clue.id)) errors.push(`stage ${stageNumber} clue IDs must be unique`);
        clueIds.add(clue.id);
      }
    }

    const validateChoices = (choices: unknown, context: string): void => {
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4) {
        errors.push(`${context} must contain 2-4 choices`);
        return;
      }
      let neutralCount = 0;
      for (const choice of choices) {
        if (!isRecord(choice)) {
          errors.push(`${context} has invalid choice`);
          continue;
        }
        rejectUnexpectedFields(choice, choiceFields, `${context} choice`, errors);
        if (!isNonEmptyString(choice.id)) errors.push(`${context} choice id must be non-empty`);
        else {
          if (choiceIds.has(choice.id)) errors.push("choice IDs must be unique");
          choiceIds.add(choice.id);
        }
        if (!isNonEmptyString(choice.label)) {
          errors.push(`${context} choice label must be non-empty`);
        }
        if (!kinds.has(choice.kind as ChoiceKind)) {
          errors.push(`${context} has invalid choice kind`);
        }
        if (choice.kind === "neutral") neutralCount++;
        if (choice.kind === "trap") {
          trapCount++;
          if (stageNumber <= 2) errors.push("trap is forbidden on stages 1-2");
        }
        if (!isNonEmptyString(choice.clueId) || !clueIds.has(choice.clueId)) {
          errors.push(`${context} choice references unknown clue`);
        }
        if (!isNonEmptyString(choice.rationale)) {
          errors.push(`${context} choice rationale must be non-empty`);
        }
        if (choice.kind === "check") {
          if (!stats.has(choice.stat as Stat)) {
            errors.push(`${context} check must have a valid stat`);
          }
          if (!tiers.has(choice.tier as string)) {
            errors.push(`${context} check must have a valid tier`);
          }
          if (!modifiers.has(choice.tacticalModifier as string)) {
            errors.push(`${context} check must have a valid tacticalModifier`);
          }
        }
        if (
          !isRecord(choice.copy) || !isNonEmptyString(choice.copy.success) ||
          !isNonEmptyString(choice.copy.neutral) || !isNonEmptyString(choice.copy.failure)
        ) {
          errors.push(`${context} choice must have complete copy`);
        } else {
          rejectUnexpectedFields(choice.copy, copyFields, `${context} choice copy`, errors);
        }
      }
      if (neutralCount === 0) errors.push(`${context} must contain a neutral choice`);
    };

    if (stageNumber === 10) {
      if ("choices" in stage) errors.push("stage 10 cannot contain ordinary choices");
      if (!Array.isArray(stage.bossExchanges) || stage.bossExchanges.length !== 2) {
        errors.push("stage 10 must contain exactly 2 boss exchanges");
      } else {
        for (let exchangeIndex = 0; exchangeIndex < stage.bossExchanges.length; exchangeIndex++) {
          const exchange = stage.bossExchanges[exchangeIndex];
          const exchangeNumber = exchangeIndex + 1;
          if (!isRecord(exchange)) {
            errors.push(`stage 10 exchange ${exchangeNumber} must be an object`);
            continue;
          }
          rejectUnexpectedFields(
            exchange,
            exchangeFields,
            `stage 10 exchange ${exchangeNumber}`,
            errors,
          );
          if (exchange.number !== exchangeNumber) {
            errors.push(`stage 10 exchange ${exchangeNumber} has wrong number`);
          }
          if (!isNonEmptyString(exchange.scene) || exchange.scene.length > 700) {
            errors.push(`stage 10 exchange ${exchangeNumber} scene must be 1-700 characters`);
          }
          validateChoices(exchange.choices, `stage 10 exchange ${exchangeNumber}`);
        }
      }
    } else {
      if ("bossExchanges" in stage) errors.push("stages 1-9 cannot contain bossExchanges");
      validateChoices(stage.choices, `stage ${stageNumber}`);
    }
  }

  if (combatCount > 3) errors.push("dungeon may contain at most 3 combat stages");
  if (researchCount === 0) errors.push("dungeon must contain a research stage");
  if (socialCount === 0) errors.push("dungeon must contain a social stage");
  if (importantCount > 2) errors.push("dungeon may contain at most 2 important choices");
  if (trapCount > 1) errors.push("dungeon may contain at most 1 trap");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function assertDungeonContentV1(value: unknown): asserts value is DungeonContentV1 {
  const result = validateDungeonContentV1(value);
  if (!result.ok) throw new Error(`Invalid dungeon-v1 content: ${result.errors.join("; ")}`);
}
