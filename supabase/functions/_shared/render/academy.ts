import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export interface AcademyCardInput {
  readonly rank: "student" | "novice";
  readonly tutorialCompleted: 0 | 1 | 2;
  readonly personalBestStage: number | null;
}

export function renderAcademyCard(input: AcademyCardInput): RenderedCard {
  const rank = input.rank === "novice" ? "Новак" : "Учень";
  const best = input.personalBestStage === null
    ? "Особистий рекорд: експедицій ще не завершено"
    : `Особистий рекорд: етап ${input.personalBestStage}`;
  return renderCard(
    [
      "Академія",
      `Ранг: ${rank}`,
      `Навчання: ${input.tutorialCompleted}/2`,
      best,
      "",
      input.tutorialCompleted < 2
        ? "Наступна ціль: завершити дві навчальні експедиції з викладачем."
        : "Наступна ціль: особиста перевірка етапу 5 без допомоги викладача.",
      "Нові ранги відкриватимуться лише через чесні заліки, а не за вхід у гру.",
    ].join("\n"),
    [[staticButton("Герой", "nav:hero"), staticButton("До меню", "nav:menu")]],
  );
}
