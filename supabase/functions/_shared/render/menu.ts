import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export interface MenuCardInput {
  readonly hasActiveRun: boolean;
  readonly tutorialCompleted?: 0 | 1 | 2;
}

export function renderMenuCard(input: MenuCardInput): RenderedCard {
  const primary = input.hasActiveRun
    ? staticButton("Продовжити експедицію", "nav:resume")
    : staticButton("Сьогоднішня експедиція", "nav:expedition");
  const tutorialCompleted = input.tutorialCompleted ?? 2;
  if (tutorialCompleted < 2) {
    return renderCard(
      [
        "Академія · навчання",
        `Прогрес: ${tutorialCompleted}/2`,
        "",
        input.hasActiveRun
          ? "Навчальна експедиція збережена."
          : "Продовжте навчання, щоб отримати перший предмет і магічне кільце.",
      ].join("\n"),
      [[primary], [staticButton("Допомога", "nav:help")]],
    );
  }
  return renderCard(
    [
      "Академія · особистий кабінет",
      "",
      input.hasActiveRun
        ? "Незавершене випробування збережено. Поверніться до поточного етапу."
        : "Перевірте, яке випробування Академія підготувала сьогодні.",
    ].join("\n"),
    [
      [primary, staticButton("Герой", "nav:hero")],
      [staticButton("Академія", "nav:academy"), staticButton("Допомога", "nav:help")],
    ],
  );
}
