import type { PreparedRunCard } from "../application/prepare-run-card.ts";
import type { DungeonContentV1, EncounterType, Stat } from "../contracts/content.ts";
import type { ResolutionV1 } from "../contracts/domain.ts";
import type { TutorialResolutionV1 } from "../progression/contracts.ts";
import { renderCard, type RenderedCard, truncatePlainText } from "./types.ts";

const STAT_LABELS: Readonly<Record<Stat, string>> = {
  physical: "Фізична сила",
  magical: "Магічна сила",
  agility: "Спритність",
  vitality: "Живучість",
};

const ENCOUNTER_LABELS: Readonly<Record<EncounterType, string>> = {
  exploration: "Розвідка Академії",
  research: "Урок досліджень",
  social: "Практикум взаємодії",
  hazard: "Небезпечна практика",
  pursuit: "Польове випробування",
  combat: "Бойова практика",
};

const TUTORIAL_LESSONS: Readonly<Record<EncounterType, string>> = {
  exploration: "Урок спостережливості",
  research: "Урок аналізу",
  social: "Урок взаємодії",
  hazard: "Урок обережності",
  pursuit: "Урок швидких рішень",
  combat: "Бойовий урок",
};

const FULL_GUIDANCE: Readonly<Record<EncounterType, string>> = {
  exploration: "Порада викладача: зіставте сліди й деталі сцени, перш ніж діяти.",
  research: "Порада викладача: шукайте причинний зв’язок, а не найгучнішу відповідь.",
  social: "Порада викладача: намір співрозмовника важливіший за красиві слова.",
  hazard: "Порада викладача: спершу визначте джерело небезпеки, потім рухайтесь.",
  pursuit: "Порада викладача: швидкість корисна лише разом із правильним напрямком.",
  combat:
    "Порада викладача: оцініть загрозу й оберіть характеристику, на яку справді спирається дія.",
};

function heading(prepared: PreparedRunCard): string {
  if (prepared.view.tutorial) {
    return `Навчання ${prepared.view.tutorial.ordinal}/2 · ${
      TUTORIAL_LESSONS[prepared.stage.encounterType]
    }`;
  }
  if (prepared.stage.number === 5) return "Мінібос · бойовий іспит";
  if (prepared.stage.number === 10) {
    return `Фінальне випробування · фаза ${prepared.view.run.exchange ?? 1}`;
  }
  return ENCOUNTER_LABELS[prepared.stage.encounterType];
}

function scene(prepared: PreparedRunCard): string {
  if (prepared.stage.number !== 10) return prepared.stage.scene;
  const exchange = prepared.view.run.exchange ?? 1;
  return prepared.stage.bossExchanges?.[exchange - 1]?.scene ?? prepared.stage.scene;
}

function observation(prepared: PreparedRunCard): string {
  if (prepared.stage.number !== 10) return prepared.stage.clues[0]?.text ?? "Немає";
  const exchange = prepared.view.run.exchange ?? 1;
  return prepared.stage.clues[exchange - 1]?.text ?? prepared.stage.clues[0]?.text ?? "Немає";
}

function choiceButtons(prepared: PreparedRunCard) {
  return prepared.choices.map((choice) => [{
    text: choice.label,
    callbackData: choice.callbackData,
  }]);
}

function stageLines(prepared: PreparedRunCard, compact: boolean): string[] {
  const sceneLimit = compact ? 900 : 2200;
  const visibleBossHp = prepared.view.run.bossHp ?? prepared.state.bossHp;
  return [
    `${heading(prepared)} · етап ${prepared.stage.number}/10`,
    `HP: ${prepared.state.hp}/${prepared.view.run.maxHp} · XP: ${prepared.state.xp}`,
    ...(prepared.stage.number === 10 && visibleBossHp !== null
      ? [`HP боса: ${visibleBossHp}`]
      : []),
    ...(prepared.view.tutorial
      ? [
        prepared.view.tutorial.guidance === "full"
          ? FULL_GUIDANCE[prepared.stage.encounterType]
          : "Орієнтир викладача: спостереження підказує шлях, але не гарантує результат.",
      ]
      : []),
    "",
    truncatePlainText(scene(prepared), sceneLimit),
    "",
    `Спостереження: ${truncatePlainText(observation(prepared), 600)}`,
    "",
    "Оберіть дію:",
  ];
}

export function renderStageCard(prepared: PreparedRunCard): RenderedCard {
  return renderCard(stageLines(prepared, false).join("\n"), choiceButtons(prepared));
}

const OUTCOME_LABELS: Readonly<Record<ResolutionV1["outcome"], string>> = {
  success: "Успіх",
  neutral: "Обережний прохід",
  failure: "Невдача",
};

export interface ResolvedCardInput {
  readonly resolution: ResolutionV1;
  readonly next: PreparedRunCard | null;
  readonly content?: DungeonContentV1;
}

export function outcomeCopy(
  content: DungeonContentV1,
  resolution: ResolutionV1,
): string | null {
  const stage = content.stages[resolution.stage - 1];
  if (!stage) return null;
  const choices = resolution.stage === 10 && resolution.exchange !== null
    ? stage.bossExchanges?.[resolution.exchange - 1]?.choices
    : stage.choices;
  const choice = choices?.find((candidate) => candidate.id === resolution.choiceId);
  return choice?.copy[resolution.outcome] ?? null;
}

export function resolutionLines(
  resolution: ResolutionV1,
  copy: string | null = null,
): string[] {
  const lines = [
    `Результат етапу ${resolution.stage}: ${OUTCOME_LABELS[resolution.outcome]}`,
    ...(copy ? [truncatePlainText(copy, 700)] : []),
    truncatePlainText(resolution.rationale, 700),
    `Спостереження: ${truncatePlainText(resolution.clue.text, 500)}`,
  ];
  if (resolution.check) {
    lines.push(
      "",
      `Перевірка — ${STAT_LABELS[resolution.check.stat]}`,
      `Ви: ${resolution.check.selfPower} · Напарник: ${resolution.check.companionPower} · Разом: ${resolution.check.totalPower} · Поріг: ${resolution.check.threshold}`,
    );
  }
  lines.push(
    "",
    `HP: ${resolution.hp.before} → ${resolution.hp.after} · Шкода: ${resolution.hp.damage}`,
    `Вампіризм: +${resolution.hp.vampHeal} · Відновлення: +${resolution.hp.postHeal}`,
    `XP: +${resolution.xp.delta} (${resolution.xp.after})`,
  );
  const tutorial = (resolution as TutorialResolutionV1).tutorial;
  if (tutorial?.teacherRescue) {
    lines.push(
      `Втручання викладача: +${tutorial.teacherRestore} HP. Це одноразове навчальне порятування, не магія кільця й не звичайне лікування.`,
    );
  }
  if (resolution.bossHp) {
    lines.push(
      `Шкода босу: ${resolution.bossHp.ownerDamage} · HP боса: ${resolution.bossHp.before} → ${resolution.bossHp.after}`,
    );
  }
  return lines;
}

export function renderResolvedCard(input: ResolvedCardInput): RenderedCard {
  const { resolution, next } = input;
  const copy = input.content ? outcomeCopy(input.content, resolution) : null;
  const lines = resolutionLines(resolution, copy);
  if (next) lines.push("", "Далі", ...stageLines(next, true));
  return renderCard(lines.join("\n"), next ? choiceButtons(next) : []);
}

export function statLabel(stat: Stat): string {
  return STAT_LABELS[stat];
}
