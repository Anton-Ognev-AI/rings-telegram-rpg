import {
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import fallbackJson from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type { PreparedRunCard } from "../../supabase/functions/_shared/application/prepare-run-card.ts";
import type {
  DungeonContentV1,
  StageV1,
} from "../../supabase/functions/_shared/contracts/content.ts";
import type { ResolutionV1 } from "../../supabase/functions/_shared/contracts/domain.ts";
import { renderMenuCard } from "../../supabase/functions/_shared/render/menu.ts";
import { renderOnboardingCard } from "../../supabase/functions/_shared/render/onboarding.ts";
import {
  renderDeletionPrompt,
  renderDeletionRetryCard,
  renderPrivacyCard,
} from "../../supabase/functions/_shared/render/privacy.ts";
import {
  renderResolvedCard,
  renderStageCard,
} from "../../supabase/functions/_shared/render/stage-card.ts";
import { renderSummaryCard } from "../../supabase/functions/_shared/render/summary.ts";

const fallback = fallbackJson as DungeonContentV1;
const token = "cb_0123456789abcdef0123456789abcdef";

function assertSingleMenuButton(card: {
  readonly buttons: ReadonlyArray<
    ReadonlyArray<{
      readonly text: string;
      readonly callbackData: string;
    }>
  >;
}): void {
  assertEquals(card.buttons.at(-1), [{
    text: "Меню",
    callbackData: "nav:menu",
  }]);
  assertEquals(
    card.buttons.flat().filter((button) => button.callbackData === "nav:menu").length,
    1,
  );
}

function preparedAt(stage: StageV1, exchange: 1 | 2 | null = null): PreparedRunCard {
  const choices = stage.number === 10
    ? stage.bossExchanges?.[(exchange ?? 1) - 1]?.choices ?? []
    : stage.choices ?? [];
  return {
    view: {
      status: "ok",
      run: {
        id: "20000000-0000-4000-8000-000000000001",
        playerId: "10000000-0000-4000-8000-000000000001",
        cycleId: "2026-08-25",
        status: "active",
        phase: "awaiting_choice",
        stateVersion: 4,
        stage: stage.number,
        exchange,
        hp: 95,
        maxHp: 150,
        bossHp: stage.number === 10 ? 120 : null,
        xpEarned: 30,
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
    },
    stage,
    party: {
      mode: "partner",
      self: {
        maxHp: 100,
        physical: 44,
        magical: 42,
        agility: 42,
        vitality: 38,
        defense: 20,
        vampRateBps: 500,
        postHeal: 2,
      },
      companion: {
        maxHp: 50,
        physical: 18,
        magical: 20,
        agility: 17,
        defense: 10,
      },
    },
    state: {
      stage: stage.number,
      exchange,
      hp: 95,
      bossHp: stage.number === 10 ? 120 : null,
      xp: 30,
      vampHealedStage: 0,
      vampHealedRun: 0,
      terminal: null,
    },
    choices: choices.map((choice, index) => ({
      raw: `${token}${index}`,
      tokenSha256: "a".repeat(64),
      contextSha256: "b".repeat(64),
      choiceId: choice.id,
      label: choice.label,
      callbackData: `${token}${index}`,
      resolution: resolution,
      resolutionSha256: "c".repeat(64),
    })),
  };
}

const resolution: ResolutionV1 = {
  resolverVersion: "v1",
  stage: 1,
  exchange: null,
  choiceId: "s1-agility",
  outcome: "success",
  clue: { id: "s1-wall", text: "Стіна <безпечна> & тиха." },
  rationale: "Спостереження спрацювало <точно>.",
  check: {
    stat: "agility",
    selfPower: 42,
    companionPower: 19,
    totalPower: 61,
    threshold: 60,
  },
  hp: { before: 95, damage: 12, vampHeal: 3, postHeal: 2, after: 88 },
  bossHp: null,
  xp: { before: 30, delta: 10, after: 40 },
  terminal: null,
  nextStage: 2,
  nextExchange: null,
};

Deno.test("unresolved cards are Telegram-safe and reveal no answer or threshold", () => {
  const unsafeStage = {
    ...fallback.stages[0],
    scene: `<b>${"Туман & камінь ".repeat(400)}</b>`,
  } satisfies StageV1;
  const card = renderStageCard(preparedAt(unsafeStage));

  assertEquals(Array.from(card.text).length <= 4096, true);
  assertStringIncludes(card.text, "&lt;b&gt;");
  assertNotMatch(card.text, /<b>/u);
  assertStringIncludes(card.text, "Розвідка Академії");
  assertStringIncludes(card.text, "Спостереження:");
  assertNotMatch(card.text, /Поріг|Успішний вибір|61|60/u);
  assertEquals(card.buttons.length, (unsafeStage.choices?.length ?? 0) + 1);
  assertEquals(
    card.buttons.slice(0, -1).flat().every((button) => button.callbackData.startsWith("cb_")),
    true,
  );
  assertSingleMenuButton(card);
  assertEquals(
    card.buttons.flat().every((button) =>
      new TextEncoder().encode(button.callbackData).byteLength <= 64
    ),
    true,
  );
});

Deno.test("resolved cards explain stats, damage, healing, XP, and keep one next keyboard", () => {
  const next = preparedAt(fallback.stages[1]);
  const card = renderResolvedCard({ resolution, next, content: fallback });

  assertStringIncludes(card.text, "Успіх");
  assertStringIncludes(card.text, "Ви входите, не зачепивши холодної завіси.");
  assertStringIncludes(card.text, "Спритність");
  assertStringIncludes(card.text, "Ви: 42");
  assertStringIncludes(card.text, "Напарник: 19");
  assertStringIncludes(card.text, "Разом: 61");
  assertStringIncludes(card.text, "Для успіху потрібно: 60");
  assertStringIncludes(card.text, "Запас: +1");
  assertStringIncludes(card.text, "Влучний підхід знизив вимогу перевірки.");
  assertStringIncludes(card.text, "Шкода: 12");
  assertStringIncludes(card.text, "Вампіризм: +3");
  assertStringIncludes(card.text, "Відновлення: +2");
  assertStringIncludes(card.text, "XP: +10 (40)");
  assertStringIncludes(card.text, "&lt;точно&gt;");
  assertEquals(card.buttons.length, next.choices.length + 1);
  assertSingleMenuButton(card);
});

Deno.test("resolved cards hide inactive effects and show a failed check shortfall", () => {
  const card = renderResolvedCard({
    resolution: {
      ...resolution,
      outcome: "failure",
      check: {
        ...resolution.check!,
        totalPower: 51,
        threshold: 60,
      },
      hp: { before: 88, damage: 12, vampHeal: 0, postHeal: 0, after: 76 },
    },
    next: null,
    content: fallback,
  });

  assertStringIncludes(card.text, "Для успіху потрібно: 60");
  assertStringIncludes(card.text, "Не вистачило: 9");
  assertNotMatch(card.text, /Вампіризм|Відновлення/u);
  assertSingleMenuButton(card);
});

Deno.test("miniboss and boss exchanges have distinct encounter headings", () => {
  assertStringIncludes(renderStageCard(preparedAt(fallback.stages[4])).text, "Мінібос");
  assertStringIncludes(
    renderStageCard(preparedAt(fallback.stages[9], 1)).text,
    "Фінальне випробування · фаза 1",
  );
  assertStringIncludes(
    renderStageCard(preparedAt(fallback.stages[9], 2)).text,
    "Фінальне випробування · фаза 2",
  );
});

Deno.test("boss outcome includes damage to both sides", () => {
  const bossResolution: ResolutionV1 = {
    ...resolution,
    stage: 10,
    exchange: 2,
    bossHp: { before: 75, ownerDamage: 60, after: 15 },
  };
  const card = renderResolvedCard({ resolution: bossResolution, next: null });
  assertStringIncludes(card.text, "Шкода босу: 60");
  assertStringIncludes(card.text, "HP боса: 75 → 15");
  assertEquals(card.buttons, [[{
    text: "Меню",
    callbackData: "nav:menu",
  }]]);
});

Deno.test("summary is honest about result and next-day return hook", () => {
  const finalResolution: ResolutionV1 = {
    ...resolution,
    stage: 10,
    exchange: 2,
    choiceId: "s10e2-magical",
    bossHp: { before: 60, ownerDamage: 60, after: 0 },
    terminal: "victory",
    nextStage: null,
  };
  const card = renderSummaryCard({
    terminal: "contained",
    deepestStage: 10,
    hp: 23,
    maxHp: 150,
    xp: 150,
    strongestSuccessfulCheck: {
      stat: "agility",
      totalPower: 61,
      threshold: 60,
    },
    lastResolution: finalResolution,
    content: fallback,
  });

  assertStringIncludes(card.text, "Загрозу стримано");
  assertStringIncludes(card.text, "Найглибший етап: 10");
  assertStringIncludes(card.text, "HP: 23/150");
  assertStringIncludes(card.text, "XP: 150");
  assertStringIncludes(card.text, "Найсильніша перевірка: Спритність 61 проти 60");
  assertStringIncludes(card.text, "Ядро гасне до завершення хвилі.");
  assertStringIncludes(card.text, "Шкода босу: 60");
  assertStringIncludes(card.text, "прогрес збережено");
  assertStringIncludes(card.text, "завтра о 09:00");
  assertNotMatch(card.text, /витрат|розподіл|прокач/u);
});

Deno.test("onboarding and menu expose compact static routes", () => {
  const intro = renderOnboardingCard();
  const menu = renderMenuCard({ hasActiveRun: true });
  assertMatch(intro.text, /учень|Академ/u);
  assertEquals(intro.buttons.flat()[0].callbackData, "nav:expedition");
  assertEquals(menu.buttons.flat()[0].callbackData, "nav:resume");
});

Deno.test("privacy and deletion confirmation are readable without claiming early completion", () => {
  const privacy = renderPrivacyCard();
  assertStringIncludes(privacy.text, "Telegram ID");
  assertStringIncludes(privacy.text, "прогрес");
  assertStringIncludes(privacy.text, "/delete_me");
  assertStringIncludes(privacy.text, "production");
  assertStringIncludes(privacy.text, "без Telegram ID");
  assertNotMatch(privacy.text, /повне видалення|видалити всі дані/u);

  const confirmation = renderDeletionPrompt("del_synthetic");
  assertStringIncludes(confirmation.text, "не можна скасувати");
  assertStringIncludes(confirmation.text, "Псевдонімний прогрес");
  assertNotMatch(confirmation.text, /Видалити всі дані|видалити все/u);
  assertNotMatch(confirmation.text, /Дані гри видалено|готово/u);
  assertEquals(confirmation.buttons.flat()[0].callbackData, "del_synthetic");
  assertEquals(confirmation.buttons.flat()[1].callbackData, "nav:menu");
  const retry = renderDeletionRetryCard("del_synthetic");
  assertStringIncludes(retry.text, "ще не завершено");
  assertEquals(retry.buttons.flat()[0].callbackData, "del_synthetic");
});
