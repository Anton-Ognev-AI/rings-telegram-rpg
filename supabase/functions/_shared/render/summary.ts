import type { DungeonContentV1, Stat } from "../contracts/content.ts";
import type { ResolutionV1, TerminalResult } from "../contracts/domain.ts";
import { outcomeCopy, resolutionLines, statLabel } from "./stage-card.ts";
import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export interface SummaryCardInput {
  readonly terminal: TerminalResult;
  readonly deepestStage: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly xp: number;
  readonly strongestSuccessfulCheck?: {
    readonly stat: Stat;
    readonly totalPower: number;
    readonly threshold: number;
  };
  readonly lastResolution?: ResolutionV1;
  readonly content?: DungeonContentV1;
  readonly tutorial?: {
    readonly completed: 0 | 1 | 2;
    readonly nextAction: "training" | "item" | "ring" | "next_tutorial";
  };
}

const RESULT_LABELS: Readonly<Record<TerminalResult, string>> = {
  victory: "Перемога над загрозою",
  contained: "Загрозу стримано",
  defeated: "Експедицію завершено поразкою",
};

export function renderSummaryCard(input: SummaryCardInput): RenderedCard {
  const lines = [
    `Підсумок: ${RESULT_LABELS[input.terminal]}`,
    "",
    `Найглибший етап: ${input.deepestStage}`,
    `HP: ${input.hp}/${input.maxHp}`,
    `XP: ${input.xp}`,
  ];
  if (input.strongestSuccessfulCheck) {
    const check = input.strongestSuccessfulCheck;
    lines.push(
      `Найсильніша перевірка: ${
        statLabel(check.stat)
      } ${check.totalPower} проти ${check.threshold}`,
    );
  }
  if (input.lastResolution) {
    const copy = input.content ? outcomeCopy(input.content, input.lastResolution) : null;
    lines.push("", ...resolutionLines(input.lastResolution, copy));
  }
  lines.push("", "Сьогоднішній XP і прогрес збережено.");
  if (input.tutorial) {
    const next = {
      training: "Наступний крок: оберіть перше тренування характеристик.",
      item: "Наступний крок: вирішіть, чи прийняти навчальний предмет.",
      ring: "Наступний крок: оберіть перше синє магічне кільце.",
      next_tutorial: "Наступний крок: друга навчальна експедиція відкриється у новому дні.",
    }[input.tutorial.nextAction];
    lines.push(`Навчання: ${input.tutorial.completed}/2.`, next);
  } else {
    lines.push("Нове випробування Академії відкриється завтра о 09:00.");
  }
  return renderCard(lines.join("\n"), [[staticButton("До кабінету", "nav:menu")]]);
}
