import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export function renderOnboardingCard(): RenderedCard {
  return renderCard(
    [
      "Вітаємо в Академії магічних кілець.",
      "",
      "Ви — учень, якому щодня доручатимуть нове випробування. Спостерігайте, обирайте шлях і поступово розвивайте власну силу.",
      "",
      "Сьогоднішня експедиція вже чекає.",
    ].join("\n"),
    [
      [staticButton("Розпочати експедицію", "nav:expedition")],
      [staticButton("Приватність", "nav:privacy")],
    ],
  );
}
