import { assertEquals, assertNotMatch, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type { PreparedRunCard } from "../../supabase/functions/_shared/application/prepare-run-card.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import type { ResolutionV1 } from "../../supabase/functions/_shared/contracts/domain.ts";
import type { CanonicalBuildView } from "../../supabase/functions/_shared/progression/build-view.ts";
import { renderAcademyCard } from "../../supabase/functions/_shared/render/academy.ts";
import { renderHelpCard } from "../../supabase/functions/_shared/render/help.ts";
import { renderHeroCard } from "../../supabase/functions/_shared/render/hero.ts";
import { renderMenuCard } from "../../supabase/functions/_shared/render/menu.ts";
import {
  renderItemOfferCard,
  renderRingOfferCard,
} from "../../supabase/functions/_shared/render/offers.ts";
import {
  renderTrainingChoiceCard,
  renderTutorialCard,
} from "../../supabase/functions/_shared/render/tutorial.ts";
import {
  renderResolvedCard,
  renderStageCard,
} from "../../supabase/functions/_shared/render/stage-card.ts";
import { renderSummaryCard } from "../../supabase/functions/_shared/render/summary.ts";

const fallback = fallbackJson as DungeonContentV1;
const pa = (suffix: string) => `pa_${suffix.padEnd(32, "0")}`;

function assertTelegramSafe(
  cards: readonly {
    text: string;
    buttons: readonly (readonly {
      callbackData: string;
    }[])[];
  }[],
): void {
  for (const card of cards) {
    assertEquals(Array.from(card.text).length <= 4096, true);
    assertEquals(
      card.buttons.flat().every((button) =>
        new TextEncoder().encode(button.callbackData).byteLength <= 64
      ),
      true,
    );
  }
}

Deno.test("tutorial and completed menus expose only useful honest actions", () => {
  const tutorial = renderTutorialCard({
    completed: 0,
    hasActiveRun: false,
    initialTrainingResolved: false,
  });
  const tutorialMenu = renderMenuCard({ hasActiveRun: false, tutorialCompleted: 0 });
  const completedMenu = renderMenuCard({ hasActiveRun: true, tutorialCompleted: 2 });

  assertStringIncludes(tutorial.text, "Навчання: 0/2");
  assertStringIncludes(tutorial.text, "викладач");
  assertEquals(tutorialMenu.buttons.flat().map((button) => button.callbackData), [
    "nav:expedition",
    "nav:help",
  ]);
  assertEquals(completedMenu.buttons.flat().map((button) => button.callbackData), [
    "nav:resume",
    "nav:hero",
    "nav:academy",
    "nav:help",
  ]);
  assertNotMatch(completedMenu.text, /Напарник|нагадуван|прорив/u);
  assertTelegramSafe([tutorial, tutorialMenu, completedMenu]);
});

Deno.test("training card shows exact server forecast and no hidden arithmetic", () => {
  const card = renderTrainingChoiceCard({
    freeXp: 20,
    options: [
      {
        stat: "physical",
        current: 5,
        next: 6,
        cost: 20,
        effect: "Фізична сила +1",
        callbackData: pa("physical"),
      },
      {
        stat: "magical",
        current: 5,
        next: 6,
        cost: 20,
        effect: "Магічна сила +1",
        callbackData: pa("magical"),
      },
      {
        stat: "agility",
        current: 5,
        next: 6,
        cost: 20,
        effect: "Спритність +1",
        callbackData: pa("agility"),
      },
      {
        stat: "vitality",
        current: 5,
        next: 6,
        cost: 20,
        effect: "Живучість +1 · максимум HP +4",
        callbackData: pa("vitality"),
      },
    ],
    deferCallbackData: pa("defer"),
  });
  assertStringIncludes(card.text, "Доступно: 20 XP");
  assertStringIncludes(card.text, "Фізична сила: 5 → 6 · 20 XP");
  assertStringIncludes(card.text, "максимум HP +4");
  assertEquals(card.buttons.length, 5);
  assertTelegramSafe([card]);
});

Deno.test("item and ring offers explain replacement and four distinct play styles", () => {
  const item = renderItemOfferCard({
    itemLabel: "Навчальний обладунок",
    slotLabel: "Обладунок",
    bonusText: "Захист +2",
    currentItemLabel: null,
    acceptCallbackData: pa("accept"),
    discardCallbackData: pa("discard"),
  });
  const ring = renderRingOfferCard({
    choices: [
      {
        label: "Кільце зброї",
        technique: "Точний удар",
        effectText: "Фізична сила 7 → 8",
        mainItemLabel: "Навчальний меч",
        callbackData: pa("weapon"),
      },
      {
        label: "Кільце вогню",
        technique: "Вогняний імпульс",
        effectText: "Магічна сила 7 → 8",
        mainItemLabel: "Учнівський жезл",
        callbackData: pa("fire"),
      },
      {
        label: "Кільце захисту",
        technique: "Стійка варта",
        effectText: "Захист 7 → 8",
        mainItemLabel: "Навчальний меч",
        callbackData: pa("defense"),
      },
      {
        label: "Кільце лікування",
        technique: "Відновлення",
        effectText: "Після бою HP +1",
        mainItemLabel: "Навчальний меч",
        callbackData: pa("healing"),
      },
    ],
  });

  assertStringIncludes(item.text, "інвентарю немає");
  assertStringIncludes(item.text, "замінить");
  assertStringIncludes(item.text, "Відмова не дає XP");
  assertStringIncludes(ring.text, "Кільце зброї");
  assertStringIncludes(ring.text, "Магічна сила 7 → 8");
  assertStringIncludes(ring.text, "Після бою HP +1");
  assertNotMatch(ring.text, /вампір/u);
  assertEquals(ring.buttons.length, 4);
  assertTelegramSafe([item, ring]);
});

const heroBuild: CanonicalBuildView = {
  selfSnapshot: {
    maxHp: 40,
    physical: 9,
    magical: 5,
    agility: 5,
    vitality: 5,
    defense: 7,
    vampRateBps: 0,
    postHeal: 0,
  },
  loadoutSnapshot: {
    progressionConfig: "progression-v1",
    items: [
      {
        slot: "main",
        itemKey: "training_sword",
        rarity: "ordinary",
        label: "Навчальний меч",
        bonuses: { physical: 2 },
      },
      {
        slot: "armor",
        itemKey: "training_armor",
        rarity: "ordinary",
        label: "Навчальний обладунок",
        bonuses: { defense: 2 },
      },
    ],
    rings: [
      {
        kind: "weapon",
        color: "blue",
        rarity: "ordinary",
        label: "Кільце зброї",
        masteryPercent: 2,
        investedXp: 40,
        blueBudget: 2000,
        combatBps: 1500,
      },
    ],
  },
  breakdown: {
    physical: [
      { source: "base", label: "База", operation: "add", amount: 5, result: 5, bps: null },
      {
        source: "purchased",
        label: "Тренування",
        operation: "add",
        amount: 1,
        result: 6,
        bps: null,
      },
      {
        source: "item:training_sword",
        label: "Навчальний меч",
        operation: "add",
        amount: 2,
        result: 8,
        bps: null,
      },
      {
        source: "ring:weapon",
        label: "Кільце зброї",
        operation: "multiply",
        amount: 1,
        result: 9,
        bps: 1500,
      },
    ],
    magical: [
      { source: "base", label: "База", operation: "add", amount: 5, result: 5, bps: null },
    ],
    agility: [
      { source: "base", label: "База", operation: "add", amount: 5, result: 5, bps: null },
    ],
    vitality: [
      { source: "base", label: "База", operation: "add", amount: 5, result: 5, bps: null },
    ],
    defense: [
      { source: "base", label: "База", operation: "add", amount: 5, result: 5, bps: null },
      {
        source: "item:training_armor",
        label: "Навчальний обладунок",
        operation: "add",
        amount: 2,
        result: 7,
        bps: null,
      },
    ],
    maxHp: [
      { source: "base", label: "База", operation: "add", amount: 40, result: 40, bps: null },
    ],
    postHeal: [],
  },
};

Deno.test("hero, Academy and help cards turn progression into a visible next goal", () => {
  const hero = renderHeroCard({
    build: heroBuild,
    freeXp: 20,
    masteryCostXp: 20,
    masteryCallbackData: pa("mastery"),
  });
  const academy = renderAcademyCard({
    rank: "novice",
    tutorialCompleted: 2,
    personalBestStage: 4,
  });
  const help = renderHelpCard();

  assertStringIncludes(hero.text, "Фізична сила: 9");
  assertStringIncludes(hero.text, "База +5");
  assertStringIncludes(hero.text, "Навчальний меч +2");
  assertStringIncludes(hero.text, "Кільце зброї +1 (×1.15)");
  assertStringIncludes(hero.text, "Майстерність: 2%");
  assertStringIncludes(hero.text, "20 XP → +1% майстерності");
  assertStringIncludes(academy.text, "Ранг: Новак");
  assertStringIncludes(academy.text, "Навчання: 2/2");
  assertStringIncludes(academy.text, "особиста перевірка етапу 5");
  assertStringIncludes(help.text, "успіх, обережний прохід або невдачу");
  assertStringIncludes(help.text, "/delete_me");
  assertTelegramSafe([hero, academy, help]);
});

function tutorialPrepared(): PreparedRunCard {
  const stage = fallback.stages[0];
  const resolution: ResolutionV1 = {
    resolverVersion: "v1",
    stage: 1,
    exchange: null,
    choiceId: stage.choices?.[0].id ?? "choice",
    outcome: "failure",
    clue: { id: "clue", text: "Слід на камені" },
    rationale: "Учень не врахував напрямок сліду.",
    check: null,
    hp: { before: 45, damage: 45, vampHeal: 0, postHeal: 0, after: 23 },
    bossHp: null,
    xp: { before: 0, delta: 0, after: 0 },
    terminal: null,
    nextStage: 2,
    nextExchange: null,
    tutorial: { teacherRescue: true, teacherRestore: 23 },
  } as ResolutionV1;
  return {
    view: {
      status: "ok",
      run: {
        id: "20000000-0000-4000-8000-000000000001",
        playerId: "10000000-0000-4000-8000-000000000001",
        cycleId: "2026-08-25",
        status: "active",
        phase: "awaiting_choice",
        stateVersion: 0,
        stage: 1,
        exchange: null,
        hp: 45,
        maxHp: 45,
        bossHp: null,
        xpEarned: 0,
      },
      selfSnapshot: {},
      loadout: {},
      content: fallback,
      cycle: {
        cycleId: "2026-08-25",
        opensAt: "2026-08-25T06:00:00.000Z",
        closesAt: "2026-08-26T06:00:00.000Z",
        graceEndsAt: "2026-08-26T08:00:00.000Z",
        status: "open",
      },
      lastResolution: null,
      card: null,
      tutorial: { ordinal: 1, guidance: "full", rescueUsed: false, resultCount: 0 },
    },
    stage,
    party: {
      mode: "tutorial",
      self: {
        maxHp: 40,
        physical: 5,
        magical: 5,
        agility: 5,
        vitality: 5,
        defense: 5,
        vampRateBps: 0,
        postHeal: 0,
      },
      companion: { maxHp: 5, physical: 4, magical: 4, agility: 4, defense: 2 },
    },
    state: {
      stage: 1,
      exchange: null,
      hp: 45,
      bossHp: null,
      xp: 0,
      vampHealedStage: 0,
      vampHealedRun: 0,
      terminal: null,
    },
    choices: (stage.choices ?? []).map((choice, index) => ({
      raw: `cb_${index}`,
      tokenSha256: "a".repeat(64),
      contextSha256: "b".repeat(64),
      choiceId: choice.id,
      label: choice.label,
      callbackData: `cb_${index}`,
      resolution: resolution as never,
      resolutionSha256: "c".repeat(64),
    })),
  };
}

Deno.test("tutorial stage guidance teaches the encounter without leaking the answer", () => {
  const prepared = tutorialPrepared();
  const stage = renderStageCard(prepared);
  const resolved = renderResolvedCard({
    resolution: prepared.choices[0].resolution,
    next: null,
    content: fallback,
  });
  const summary = renderSummaryCard({
    terminal: "defeated",
    deepestStage: 4,
    hp: 0,
    maxHp: 45,
    xp: 20,
    tutorial: { completed: 1, nextAction: "training" },
  });

  assertStringIncludes(stage.text, "Навчання 1/2");
  assertStringIncludes(stage.text, "Урок спостережливості");
  assertStringIncludes(stage.text, "Порада викладача");
  assertNotMatch(stage.text, /Поріг|правильн|успішн/u);
  assertStringIncludes(resolved.text, "Втручання викладача: +23 HP");
  assertStringIncludes(resolved.text, "не магія кільця");
  assertStringIncludes(summary.text, "Навчання: 1/2");
  assertStringIncludes(summary.text, "оберіть перше тренування");
  assertNotMatch(summary.text, /завтра о 09:00/u);
  assertTelegramSafe([stage, resolved, summary]);
});
