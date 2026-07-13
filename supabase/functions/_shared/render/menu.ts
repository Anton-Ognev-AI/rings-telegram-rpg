import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export interface MenuCardInput {
  readonly hasActiveRun: boolean;
}

export function renderMenuCard(input: MenuCardInput): RenderedCard {
  const primary = input.hasActiveRun
    ? staticButton("Продовжити експедицію", "nav:resume")
    : staticButton("Сьогоднішня експедиція", "nav:expedition");
  return renderCard(
    [
      "Академія · особистий кабінет",
      "",
      input.hasActiveRun
        ? "Незавершене випробування збережено. Поверніться до поточного етапу."
        : "Перевірте, яке випробування Академія підготувала сьогодні.",
    ].join("\n"),
    [[primary], [staticButton("Приватність", "nav:privacy")]],
  );
}
