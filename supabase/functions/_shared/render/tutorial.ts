import type { Stat } from "../contracts/content.ts";
import { renderCard, type RenderedCard, staticButton } from "./types.ts";

const STAT_LABELS: Readonly<Record<Stat, string>> = {
  physical: "Фізична сила",
  magical: "Магічна сила",
  agility: "Спритність",
  vitality: "Живучість",
};

export interface TutorialCardInput {
  readonly completed: 0 | 1 | 2;
  readonly hasActiveRun: boolean;
  readonly initialTrainingResolved: boolean;
}

export function renderTutorialCard(input: TutorialCardInput): RenderedCard {
  const primary = input.hasActiveRun
    ? staticButton("Продовжити навчання", "nav:resume")
    : input.completed === 1 && !input.initialTrainingResolved
    ? staticButton("Обрати тренування", "nav:training")
    : staticButton("Почати навчальну експедицію", "nav:expedition");
  const next = input.completed === 0
    ? "Поруч іде викладач: пояснює правила у момент першої зустрічі й один раз урятує від надто ранньої поразки."
    : input.completed === 1 && !input.initialTrainingResolved
    ? "Перший вихід завершено. Вкладіть здобутий XP у характеристику або відкладіть рішення — після цього відкриється друга експедиція."
    : input.completed === 1
    ? "Другий вихід дасть перший предмет і вибір синього магічного кільця."
    : "Навчання завершено. Ваш предмет і кільце вже впливатимуть на наступний незмінний snapshot експедиції.";
  return renderCard(
    [
      "Академія магічних кілець",
      `Навчання: ${input.completed}/2`,
      "",
      "Ви — учень Академії. Читайте спостереження, обирайте дію й дивіться, які характеристики спрацювали після вибору.",
      "",
      next,
    ].join("\n"),
    [
      [primary],
      [staticButton("Герой", "nav:hero"), staticButton("Допомога", "nav:help")],
    ],
  );
}

export interface TrainingChoiceOption {
  readonly stat: Stat;
  readonly current: number;
  readonly next: number;
  readonly cost: number;
  readonly effect: string;
  readonly callbackData: string;
}

export interface TrainingChoiceCardInput {
  readonly freeXp: number;
  readonly options: readonly TrainingChoiceOption[];
  readonly deferCallbackData: string;
}

export function renderTrainingChoiceCard(input: TrainingChoiceCardInput): RenderedCard {
  const lines = [
    "Перше тренування",
    `Доступно: ${input.freeXp} XP`,
    "",
    "Оберіть, у що вкласти досвід. Показані числа — точний прогноз сервера:",
  ];
  for (const option of input.options) {
    const remainingXp = input.freeXp - option.cost;
    lines.push(
      `${
        STAT_LABELS[option.stat]
      }: ${option.current} → ${option.next} · ${option.cost} XP · залишиться ${remainingXp} XP`,
      `  ${option.effect}`,
    );
  }
  lines.push("", "Рішення можна відкласти без втрати XP.");
  const buttons = input.options.map((option) => [{
    text: `${STAT_LABELS[option.stat]} ${option.current}→${option.next} · ${option.cost} XP`,
    callbackData: option.callbackData,
  }]);
  buttons.push([{ text: "Відкласти", callbackData: input.deferCallbackData }]);
  return renderCard(lines.join("\n"), buttons);
}
