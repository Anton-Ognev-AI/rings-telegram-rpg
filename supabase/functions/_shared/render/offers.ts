import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export interface ItemOfferCardInput {
  readonly itemLabel: string;
  readonly slotLabel: string;
  readonly bonusText: string;
  readonly currentItemLabel: string | null;
  readonly acceptCallbackData: string;
  readonly discardCallbackData: string;
}

export function renderItemOfferCard(input: ItemOfferCardInput): RenderedCard {
  const current = input.currentItemLabel
    ? `Зараз у слоті: ${input.currentItemLabel}. Новий предмет замінить його.`
    : `Слот «${input.slotLabel}» порожній; прийняття одразу спорядить предмет.`;
  return renderCard(
    [
      "Нагорода за друге навчання · предмет",
      "",
      input.itemLabel,
      `${input.slotLabel} · ${input.bonusText}`,
      "",
      current,
      "У грі інвентарю немає: предмет треба прийняти зараз або викинути.",
      "Наступна знахідка в цьому слоті замінить поточний предмет.",
      "Відмова не дає XP.",
    ].join("\n"),
    [[
      { text: "Прийняти", callbackData: input.acceptCallbackData },
      { text: "Викинути", callbackData: input.discardCallbackData },
    ]],
  );
}

export interface FieldItemOfferCardInput extends ItemOfferCardInput {
  readonly resolvedText: string;
  readonly nextStage: number;
}

export function renderFieldItemOfferCard(input: FieldItemOfferCardInput): RenderedCard {
  const current = input.currentItemLabel
    ? `Зараз у слоті: ${input.currentItemLabel}. Нова знахідка замінить його.`
    : `Слот «${input.slotLabel}» порожній; якщо вдягнути знахідку, вона одразу займе цей слот.`;
  return renderCard(
    [
      input.resolvedText,
      "",
      "Знахідка між етапами",
      "",
      input.itemLabel,
      `${input.slotLabel} · ${input.bonusText}`,
      "",
      current,
      "У грі інвентарю немає: предмет треба вдягнути зараз або викинути.",
      `Якщо вдягнути, бонус діятиме вже на наступному етапі ${input.nextStage}.`,
    ].join("\n"),
    [
      [
        { text: "Вдягнути", callbackData: input.acceptCallbackData },
        { text: "Викинути", callbackData: input.discardCallbackData },
      ],
      [staticButton("Меню", "nav:menu")],
    ],
  );
}

export interface RingOfferChoice {
  readonly label: string;
  readonly technique: string;
  readonly effectText: string;
  readonly mainItemLabel: string;
  readonly callbackData: string;
}

export interface RingOfferCardInput {
  readonly choices: readonly RingOfferChoice[];
}

export function renderRingOfferCard(input: RingOfferCardInput): RenderedCard {
  const lines = [
    "Нагорода за друге навчання · синє кільце",
    "",
    "Оберіть одну магічну стихію. Академія одразу видасть сумісний основний предмет:",
  ];
  for (const choice of input.choices) {
    lines.push(
      "",
      `${choice.label} · ${choice.technique}`,
      `${choice.effectText} · ${choice.mainItemLabel}`,
    );
  }
  lines.push("", "Усі чотири кільця звичайні й сині; вибір завершує навчання 2/2.");
  return renderCard(
    lines.join("\n"),
    input.choices.map((choice) => [{
      text: choice.label,
      callbackData: choice.callbackData,
    }]),
  );
}
