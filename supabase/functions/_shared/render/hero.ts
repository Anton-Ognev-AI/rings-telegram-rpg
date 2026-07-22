import type { BuildContribution, CanonicalBuildView } from "../progression/build-view.ts";
import { renderCard, type RenderedCard, staticButton } from "./types.ts";
import { renderUpgradeTotals, type UpgradeTotals } from "./upgrade-totals.ts";

const DISPLAY_STATS = [
  ["physical", "Фізична сила"],
  ["magical", "Магічна сила"],
  ["agility", "Спритність"],
  ["vitality", "Живучість"],
  ["defense", "Захист"],
  ["maxHp", "Максимум HP"],
  ["postHeal", "Відновлення після бою"],
] as const;

const ITEM_SLOTS = [
  ["main", "Основний предмет"],
  ["armor", "Обладунок"],
  ["talisman", "Талісман"],
] as const;

const UPGRADE_STAT_LABELS = {
  physical: "Фізична сила",
  magical: "Магічна сила",
  agility: "Спритність",
  vitality: "Живучість",
} as const;

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
  if (input.build.selfSnapshot.vampRateBps > 0) {
    lines.push(`Вампіризм: ${input.build.selfSnapshot.vampRateBps / 100}%`);
  }
  lines.push("", "Спорядження");
  for (const [slot, label] of ITEM_SLOTS) {
    const item = input.build.loadoutSnapshot.items.find((candidate) => candidate.slot === slot);
    lines.push(`${label}: ${item?.label ?? "порожньо"}`);
  }
  const ring = input.build.loadoutSnapshot.rings[0];
  if (ring) {
    lines.push(
      "",
      `Магічне кільце: ${ring.label}`,
      "Синє · звичайне",
      `Майстерність: ${ring.masteryPercent}% · вкладено ${ring.investedXp}/${ring.blueBudget} XP`,
      `${input.masteryCostXp} XP → +1% майстерності. Бойовий бонус синього кільця лишається 15% до майбутнього прориву.`,
    );
  } else {
    lines.push("", "Магічні кільця: немає");
  }
  const buttons = [];
  if (ring && input.masteryCallbackData) {
    buttons.push([{
      text: `+1% майстерності · ${input.masteryCostXp} XP`,
      callbackData: input.masteryCallbackData,
    }]);
  }
  buttons.push([staticButton("Керувати XP", "nav:hero-manage")]);
  buttons.push([
    staticButton("Академія", "nav:academy"),
    staticButton("До меню", "nav:menu"),
  ]);
  return renderCard(lines.join("\n"), buttons);
}

export interface HeroUpgradeOption {
  readonly stat: "physical" | "magical" | "agility" | "vitality";
  readonly current: number;
  readonly next: number;
  readonly cost: number;
  readonly totals?: UpgradeTotals;
  readonly callbackData?: string;
}

export interface HeroManagementCardInput {
  readonly freeXp: number;
  readonly hasActiveRun: boolean;
  readonly options: readonly HeroUpgradeOption[];
  readonly mastery?: {
    readonly current: number;
    readonly cost: number;
    readonly callbackData?: string;
  };
}

function xpOutcome(freeXp: number, cost: number): string {
  return freeXp >= cost ? `залишиться ${freeXp - cost} XP` : `бракує ${cost - freeXp} XP`;
}

export function renderHeroManagementCard(input: HeroManagementCardInput): RenderedCard {
  const lines = [
    "Керування персонажем",
    `Вільний досвід: ${input.freeXp} XP`,
    "",
    "Покращення характеристик",
  ];
  const buttons: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const option of input.options) {
    const label = UPGRADE_STAT_LABELS[option.stat];
    lines.push(
      `${label}: ${option.current} → ${option.next} · ${option.cost} XP · ${
        xpOutcome(input.freeXp, option.cost)
      }`,
      ...renderUpgradeTotals(option.totals).map((line) => `  ${line}`),
    );
    if (option.callbackData) {
      buttons.push([{
        text: `${label} ${option.current}→${option.next} · ${option.cost} XP`,
        callbackData: option.callbackData,
      }]);
    }
  }
  if (input.mastery) {
    lines.push(
      "",
      `Майстерність кільця: ${input.mastery.current}% → ${
        input.mastery.current + 1
      }% · ${input.mastery.cost} XP · ${xpOutcome(input.freeXp, input.mastery.cost)}`,
    );
    if (input.mastery.callbackData) {
      buttons.push([{
        text: `Майстерність ${input.mastery.current}%→${
          input.mastery.current + 1
        }% · ${input.mastery.cost} XP`,
        callbackData: input.mastery.callbackData,
      }]);
    }
  }
  if (input.hasActiveRun) {
    lines.push(
      "",
      "Поточна експедиція не зміниться: нові характеристики діятимуть у наступному виході.",
    );
  }
  if (buttons.length === 0) {
    lines.push("", "Поки що XP недостатньо для доступного покращення.");
  }
  buttons.push([
    staticButton("Герой", "nav:hero"),
    staticButton("До меню", "nav:menu"),
  ]);
  return renderCard(lines.join("\n"), buttons);
}
