import type { BuildContribution, CanonicalBuildView } from "../progression/build-view.ts";
import { renderCard, type RenderedCard, staticButton } from "./types.ts";

const DISPLAY_STATS = [
  ["physical", "Фізична сила"],
  ["magical", "Магічна сила"],
  ["agility", "Спритність"],
  ["vitality", "Живучість"],
  ["defense", "Захист"],
  ["maxHp", "Максимум HP"],
  ["postHeal", "Відновлення після бою"],
] as const;

function contributionText(contribution: BuildContribution): string {
  const base = `${contribution.label} +${contribution.amount}`;
  if (contribution.operation === "add") return base;
  return `${base} (×${(1 + (contribution.bps ?? 0) / 10000).toFixed(2)})`;
}

export interface HeroCardInput {
  readonly build: CanonicalBuildView;
  readonly freeXp: number;
  readonly masteryCostXp: number;
  readonly masteryCallbackData?: string;
}

export function renderHeroCard(input: HeroCardInput): RenderedCard {
  const lines = ["Герой", `Вільний досвід: ${input.freeXp} XP`, ""];
  for (const [stat, label] of DISPLAY_STATS) {
    const value = input.build.selfSnapshot[stat];
    const contributions = input.build.breakdown[stat];
    if (stat === "postHeal" && value === 0 && contributions.length === 0) continue;
    lines.push(`${label}: ${value}`);
    if (contributions.length > 0) {
      lines.push(`  ${contributions.map(contributionText).join(" · ")}`);
    }
  }
  const ring = input.build.loadoutSnapshot.rings[0];
  if (ring) {
    lines.push(
      "",
      `${ring.label} · синє · звичайне`,
      `Майстерність: ${ring.masteryPercent}% · вкладено ${ring.investedXp}/${ring.blueBudget} XP`,
      `${input.masteryCostXp} XP → +1% майстерності. Бойовий бонус синього кільця лишається 15% до майбутнього прориву.`,
    );
  }
  const buttons = [];
  if (ring && input.masteryCallbackData) {
    buttons.push([{
      text: `+1% майстерності · ${input.masteryCostXp} XP`,
      callbackData: input.masteryCallbackData,
    }]);
  }
  buttons.push([
    staticButton("Академія", "nav:academy"),
    staticButton("До меню", "nav:menu"),
  ]);
  return renderCard(lines.join("\n"), buttons);
}
