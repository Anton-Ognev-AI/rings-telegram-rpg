import { getPlayerHome } from "../application/player-home.ts";
import {
  preparePlayerAction,
  type ProfileAction,
  resolvePlayerAction,
} from "../application/player-action.ts";
import type { TelegramRunView } from "../application/prepare-run-card.ts";
import type { ResolutionV1 } from "../contracts/domain.ts";
import { requestProfileRunRender, requestRunRender } from "../application/request-run-render.ts";
import type { CommandResult, DatabasePort } from "../application/database-port.ts";
import type { Clock } from "../infrastructure/clock.ts";
import { parseCanonicalBuildView } from "../progression/build-view.ts";
import {
  STARTER_ITEM_CATALOG,
  type StarterItemKey,
  type StarterRingKind,
} from "../progression/catalog.ts";
import { renderAcademyCard } from "../render/academy.ts";
import { renderHelpCard } from "../render/help.ts";
import { renderHeroCard, renderHeroManagementCard } from "../render/hero.ts";
import { renderMenuCard } from "../render/menu.ts";
import {
  renderFieldItemOfferCard,
  renderItemOfferCard,
  renderRingOfferCard,
} from "../render/offers.ts";
import { renderResolvedCard } from "../render/stage-card.ts";
import { renderTrainingChoiceCard, renderTutorialCard } from "../render/tutorial.ts";
import { renderCard, type RenderedCard, staticButton } from "../render/types.ts";
import {
  deriveHeroManagementCallbackToken,
  derivePlayerCallbackToken,
  hashHeroManagementCallbackForActor,
  hashPlayerCallbackForActor,
} from "./player-callback-token.ts";
import type { TelegramPort } from "./port.ts";
import type { NormalizedCallbackUpdate } from "./update.ts";

type CanonicalDestination = "home" | "expedition" | "resume" | "hero" | "academy" | "help";
type TutorialProgress = 0 | 1 | 2;

interface TrainingForecast {
  readonly masteryCostXp: number;
  readonly options: readonly {
    readonly stat: "physical" | "magical" | "agility" | "vitality";
    readonly current: number;
    readonly next: number;
    readonly cost: number;
    readonly statDelta: number;
    readonly maxHpDelta: number;
    readonly defenseDelta: number;
  }[];
}

interface PendingOffer {
  readonly id: string;
  readonly kind: "field_item" | "tutorial_item" | "starter_ring";
  readonly sequence: number;
  readonly sourceRunId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface CanonicalPlayerHome {
  readonly status: "ok";
  readonly playerId: string;
  readonly profileVersion: number;
  readonly tutorialCompleted: TutorialProgress;
  readonly rank: "student" | "novice";
  readonly initialTrainingResolved: boolean;
  readonly freeXp: number;
  readonly pendingOffer: PendingOffer | null;
  readonly activeRunId: string | null;
  readonly lastTerminalRunId: string | null;
  readonly personalBestStage: number | null;
  readonly training: TrainingForecast;
  readonly build: unknown;
}

export interface ProgressionCardDependencies {
  readonly database: DatabasePort;
  readonly clock: Clock;
  readonly callbackKey: Uint8Array;
}

export interface ProgressionRouterDependencies extends ProgressionCardDependencies {
  readonly telegram: TelegramPort;
}

export interface RouteCanonicalHomeInput {
  readonly playerId: string;
  readonly chatId: bigint;
  readonly updateId: bigint;
  readonly destination: CanonicalDestination;
}

export interface CanonicalRouteResult {
  readonly route: string;
}

type HomeRenderRequest =
  | { readonly status: "none" }
  | { readonly status: "requested"; readonly runId: string }
  | { readonly status: "delivery_pending"; readonly runId: string };

const PROFILE_ACTION_REJECTED_CARD = renderCard(
  "Ця дія більше недоступна. Відкрийте актуальну картку й повторіть вибір.",
  [[staticButton("До кабінету", "nav:home")]],
);
const HERO_MANAGEMENT_REJECTED_CARD = renderCard(
  "Ця дія більше недоступна. Відкрийте актуальну картку героя й повторіть вибір.",
  [[staticButton("Герой", "nav:hero")]],
);
const RUN_DELIVERY_PENDING_CARD = renderCard(
  [
    "Експедицію вже відкрито",
    "",
    "Перша сцена ще готується до доставки. Прогрес збережено — повторно запускати експедицію не потрібно.",
    "",
    "Натисніть «Оновити» через кілька секунд.",
  ].join("\n"),
  [
    [staticButton("Оновити", "nav:resume")],
    [staticButton("Герой", "nav:hero"), staticButton("До меню", "nav:menu")],
  ],
);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function nullableString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function parseOffer(value: unknown): PendingOffer | null {
  if (value === null) return null;
  if (
    !isRecord(value) || typeof value.id !== "string" ||
    (value.kind !== "field_item" && value.kind !== "tutorial_item" &&
      value.kind !== "starter_ring") ||
    !safeInteger(value.sequence, 1) || typeof value.sourceRunId !== "string" ||
    !isRecord(value.payload)
  ) throw new Error("invalid_player_home");
  return value as unknown as PendingOffer;
}

function parseTraining(value: unknown): TrainingForecast {
  if (!isRecord(value) || !safeInteger(value.masteryCostXp, 1) || !Array.isArray(value.options)) {
    throw new Error("invalid_player_home");
  }
  const allowed = new Set(["physical", "magical", "agility", "vitality"]);
  const seen = new Set<string>();
  for (const option of value.options) {
    if (
      !isRecord(option) || typeof option.stat !== "string" || !allowed.has(option.stat) ||
      seen.has(option.stat) || !safeInteger(option.current) || !safeInteger(option.next) ||
      option.next <= option.current || !safeInteger(option.cost, 1) ||
      !safeInteger(option.statDelta) || !safeInteger(option.maxHpDelta) ||
      !safeInteger(option.defenseDelta)
    ) throw new Error("invalid_player_home");
    seen.add(option.stat);
  }
  if (seen.size !== 4) throw new Error("invalid_player_home");
  return value as unknown as TrainingForecast;
}

function parseHome(value: CommandResult): CanonicalPlayerHome {
  if (
    value.status !== "ok" || typeof value.playerId !== "string" ||
    !safeInteger(value.profileVersion) || !safeInteger(value.tutorialCompleted) ||
    value.tutorialCompleted > 2 || (value.rank !== "student" && value.rank !== "novice") ||
    typeof value.initialTrainingResolved !== "boolean" || !safeInteger(value.freeXp) ||
    !nullableString(value.activeRunId) || !nullableString(value.lastTerminalRunId) ||
    !(value.personalBestStage === null || safeInteger(value.personalBestStage, 1))
  ) throw new Error("invalid_player_home");
  parseOffer(value.pendingOffer);
  parseTraining(value.training);
  parseCanonicalBuildView(value.build);
  return value as unknown as CanonicalPlayerHome;
}

async function sendCard(
  telegram: TelegramPort,
  chatId: bigint,
  card: RenderedCard,
): Promise<void> {
  await telegram.sendMessage({
    chatId: chatId.toString(),
    text: card.text,
    buttons: card.buttons,
    parseMode: "HTML",
  });
}

function runToRender(home: CanonicalPlayerHome, includeTerminal: boolean): string | null {
  if (home.pendingOffer?.kind === "field_item") return home.activeRunId;
  if (home.pendingOffer !== null) return home.lastTerminalRunId;
  if (home.activeRunId !== null) return home.activeRunId;
  if (!home.initialTrainingResolved) return home.lastTerminalRunId;
  return includeTerminal ? home.lastTerminalRunId : null;
}

async function requestHomeRender(
  database: DatabasePort,
  home: CanonicalPlayerHome,
  includeTerminal = false,
): Promise<HomeRenderRequest> {
  const runId = runToRender(home, includeTerminal);
  if (runId === null) return { status: "none" };
  const requested = await requestRunRender(database, { playerId: home.playerId, runId });
  if (requested.status === "applied" || requested.status === "cached") {
    return { status: "requested", runId };
  }
  if (requested.status === "rejected" && requested.reason === "card_unavailable") {
    return { status: "delivery_pending", runId };
  }
  throw new Error("request_run_render_rejected");
}

function masteryCost(home: CanonicalPlayerHome): number {
  return home.training.masteryCostXp;
}

async function directProjection(
  dependencies: ProgressionRouterDependencies,
  home: CanonicalPlayerHome,
  destination: "hero" | "academy" | "help",
  chatId: bigint,
): Promise<void> {
  if (destination === "hero") {
    await sendCard(
      dependencies.telegram,
      chatId,
      renderHeroCard({
        build: parseCanonicalBuildView(home.build),
        freeXp: home.freeXp,
        masteryCostXp: masteryCost(home),
      }),
    );
    return;
  }
  if (destination === "academy") {
    await sendCard(
      dependencies.telegram,
      chatId,
      renderAcademyCard({
        rank: home.rank,
        tutorialCompleted: home.tutorialCompleted,
        personalBestStage: home.personalBestStage,
      }),
    );
    return;
  }
  await sendCard(dependencies.telegram, chatId, renderHelpCard());
}

export async function routeCanonicalHome(
  dependencies: ProgressionRouterDependencies,
  input: RouteCanonicalHomeInput,
): Promise<CanonicalRouteResult> {
  if (input.destination === "expedition") {
    const started = await dependencies.database.call<CommandResult>("start_run_v3", {
      p_player_id: input.playerId,
      p_at: dependencies.clock.now().toISOString(),
    });
    if (started.status !== "applied" && started.status !== "cached") {
      if (
        started.reason === "tutorial_decision_pending" ||
        started.reason === "initial_training_decision_pending"
      ) {
        return routeCanonicalHome(dependencies, { ...input, destination: "resume" });
      }
      await sendCard(
        dependencies.telegram,
        input.chatId,
        renderCard(
          "Експедиція зараз недоступна. Поверніться до кабінету — там видно поточний стан навчання.",
          [[staticButton("До кабінету", "nav:home")]],
        ),
      );
      return { route: `expedition_${started.status}` };
    }
    if (started.status === "cached") {
      return routeCanonicalHome(dependencies, { ...input, destination: "resume" });
    }
    return { route: "expedition_started" };
  }

  const home = parseHome(await getPlayerHome(dependencies.database, input.playerId));
  if (
    input.destination === "hero" || input.destination === "academy" || input.destination === "help"
  ) {
    await directProjection(dependencies, home, input.destination, input.chatId);
    return { route: input.destination };
  }

  const renderRequest = await requestHomeRender(
    dependencies.database,
    home,
    input.destination === "resume",
  );
  if (renderRequest.status === "delivery_pending") {
    await sendCard(dependencies.telegram, input.chatId, RUN_DELIVERY_PENDING_CARD);
    return { route: "run_delivery_pending" };
  }
  if (renderRequest.status === "requested") {
    if (home.pendingOffer !== null) return { route: "offer_pending" };
    if (!home.initialTrainingResolved && home.activeRunId === null) {
      return { route: "training_pending" };
    }
    return {
      route: home.activeRunId === renderRequest.runId ? "run_resumed" : "terminal_resumed",
    };
  }

  const card = home.tutorialCompleted < 2
    ? renderTutorialCard({
      completed: home.tutorialCompleted,
      hasActiveRun: home.activeRunId !== null,
      initialTrainingResolved: home.initialTrainingResolved,
    })
    : renderMenuCard({ hasActiveRun: false, tutorialCompleted: home.tutorialCompleted });
  await sendCard(dependencies.telegram, input.chatId, card);
  return { route: input.destination === "resume" ? "resume_empty" : "home" };
}

export async function handleCanonicalProfileCallback(
  dependencies: ProgressionRouterDependencies,
  input: { readonly playerId: string; readonly update: NormalizedCallbackUpdate },
): Promise<CanonicalRouteResult> {
  let hashes: Awaited<ReturnType<typeof hashPlayerCallbackForActor>>;
  try {
    hashes = await hashPlayerCallbackForActor(input.update.data, input.playerId);
  } catch {
    await sendCard(
      dependencies.telegram,
      input.update.chatId,
      PROFILE_ACTION_REJECTED_CARD,
    );
    return { route: "profile_rejected" };
  }
  const result = await resolvePlayerAction(dependencies.database, {
    ...hashes,
    telegramUpdateId: input.update.updateId,
    actorPlayerId: input.playerId,
    callbackMessageId: input.update.messageId,
  });
  if (!["applied", "cached", "stale"].includes(result.status)) {
    await sendCard(
      dependencies.telegram,
      input.update.chatId,
      PROFILE_ACTION_REJECTED_CARD,
    );
    return { route: "profile_rejected" };
  }
  const home = parseHome(await getPlayerHome(dependencies.database, input.playerId));
  const runId = runToRender(home, true);
  if (runId === null) throw new Error("profile_render_run_unavailable");
  const requested = await requestProfileRunRender(dependencies.database, {
    playerId: home.playerId,
    runId,
    profileVersion: home.profileVersion,
  });
  if (requested.status !== "applied" && requested.status !== "cached") {
    throw new Error("request_profile_run_render_rejected");
  }
  return { route: `profile_${result.status}` };
}

function effectText(option: TrainingForecast["options"][number]): string {
  const effects = [`${option.stat} +${option.statDelta}`];
  if (option.maxHpDelta > 0) effects.push(`максимум HP +${option.maxHpDelta}`);
  if (option.defenseDelta > 0) effects.push(`захист +${option.defenseDelta}`);
  return effects.join(" · ");
}

async function prepareProfileAction(
  dependencies: ProgressionCardDependencies,
  home: CanonicalPlayerHome,
  messageId: bigint,
  action: ProfileAction,
): Promise<string> {
  const token = await derivePlayerCallbackToken(dependencies.callbackKey, {
    playerId: home.playerId,
    profileVersion: home.profileVersion,
    messageId,
    action,
  });
  const expiresAt = new Date(dependencies.clock.now().getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString();
  const result = await preparePlayerAction(dependencies.database, {
    playerId: home.playerId,
    tokenSha256: token.tokenSha256,
    profileVersion: home.profileVersion,
    messageId,
    action,
    contextSha256: token.contextSha256,
    expiresAt,
  });
  if (result.status !== "ok" && result.status !== "cached") {
    throw new Error("prepare_player_action_rejected");
  }
  return token.raw;
}

async function prepareHeroManagementAction(
  dependencies: ProgressionCardDependencies,
  home: CanonicalPlayerHome,
  messageId: bigint,
  action: ProfileAction,
): Promise<string> {
  const token = await deriveHeroManagementCallbackToken(dependencies.callbackKey, {
    playerId: home.playerId,
    profileVersion: home.profileVersion,
    messageId,
    action,
  });
  const expiresAt = new Date(dependencies.clock.now().getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString();
  const result = await preparePlayerAction(dependencies.database, {
    playerId: home.playerId,
    tokenSha256: token.tokenSha256,
    profileVersion: home.profileVersion,
    messageId,
    action,
    contextSha256: token.contextSha256,
    expiresAt,
  });
  if (result.status !== "ok" && result.status !== "cached") {
    throw new Error("prepare_hero_management_action_rejected");
  }
  return token.raw;
}

async function refreshHeroManagement(
  dependencies: ProgressionRouterDependencies,
  home: CanonicalPlayerHome,
  input: { readonly chatId: bigint; readonly messageId: bigint },
): Promise<void> {
  const options = [];
  for (const option of home.training.options) {
    const callbackData = option.cost <= home.freeXp
      ? await prepareHeroManagementAction(dependencies, home, input.messageId, {
        kind: "buy_stat",
        stat: option.stat,
      })
      : undefined;
    options.push({ ...option, effect: effectText(option), callbackData });
  }
  const build = parseCanonicalBuildView(home.build);
  const ring = build.loadoutSnapshot.rings[0];
  const mastery = ring && ring.masteryPercent < 100
    ? {
      current: ring.masteryPercent,
      cost: masteryCost(home),
      callbackData: masteryCost(home) <= home.freeXp
        ? await prepareHeroManagementAction(dependencies, home, input.messageId, {
          kind: "train_ring_mastery",
        })
        : undefined,
    }
    : undefined;
  const card = renderHeroManagementCard({
    freeXp: home.freeXp,
    hasActiveRun: home.activeRunId !== null,
    options,
    mastery,
  });
  await dependencies.telegram.editMessage({
    chatId: input.chatId.toString(),
    messageId: input.messageId,
    text: card.text,
    buttons: card.buttons,
    parseMode: "HTML",
  });
}

export async function openHeroManagement(
  dependencies: ProgressionRouterDependencies,
  input: { readonly playerId: string; readonly chatId: bigint; readonly messageId: bigint },
): Promise<CanonicalRouteResult> {
  const home = parseHome(await getPlayerHome(dependencies.database, input.playerId));
  await refreshHeroManagement(dependencies, home, input);
  return { route: "hero_management" };
}

export async function handleHeroManagementCallback(
  dependencies: ProgressionRouterDependencies,
  input: { readonly playerId: string; readonly update: NormalizedCallbackUpdate },
): Promise<CanonicalRouteResult> {
  let hashes: Awaited<ReturnType<typeof hashHeroManagementCallbackForActor>>;
  try {
    hashes = await hashHeroManagementCallbackForActor(input.update.data, input.playerId);
  } catch {
    await sendCard(
      dependencies.telegram,
      input.update.chatId,
      HERO_MANAGEMENT_REJECTED_CARD,
    );
    return { route: "hero_management_rejected" };
  }
  const result = await resolvePlayerAction(dependencies.database, {
    ...hashes,
    telegramUpdateId: input.update.updateId,
    actorPlayerId: input.playerId,
    callbackMessageId: input.update.messageId,
  });
  if (!["applied", "cached", "stale"].includes(result.status)) {
    await sendCard(
      dependencies.telegram,
      input.update.chatId,
      HERO_MANAGEMENT_REJECTED_CARD,
    );
    return { route: "hero_management_rejected" };
  }
  const home = parseHome(await getPlayerHome(dependencies.database, input.playerId));
  await refreshHeroManagement(dependencies, home, {
    chatId: input.update.chatId,
    messageId: input.update.messageId,
  });
  return { route: `hero_management_${result.status}` };
}

function parseMessageId(view: TelegramRunView): bigint {
  if (view.card === null || !/^[1-9][0-9]*$/u.test(view.card.messageId)) {
    throw new Error("progression_card_not_bound");
  }
  return BigInt(view.card.messageId);
}

function itemOfferPayload(offer: PendingOffer): {
  readonly itemKey: StarterItemKey;
  readonly slot: "main" | "armor" | "talisman";
} {
  const itemKey = offer.payload.itemKey;
  if (typeof itemKey !== "string" || !(itemKey in STARTER_ITEM_CATALOG)) {
    throw new Error("invalid_item_offer");
  }
  const catalog = STARTER_ITEM_CATALOG[itemKey as StarterItemKey];
  if (offer.payload.slot !== catalog.slot) throw new Error("invalid_item_offer");
  return { itemKey: itemKey as StarterItemKey, slot: catalog.slot };
}

function bonusText(bonuses: Readonly<Record<string, number>>): string {
  const labels: Readonly<Record<string, string>> = {
    physical: "Фізична сила",
    magical: "Магічна сила",
    defense: "Захист",
    maxHp: "Максимум HP",
  };
  return Object.entries(bonuses).map(([stat, amount]) => `${labels[stat] ?? stat} +${amount}`).join(
    " · ",
  );
}

function ringChoices(offer: PendingOffer): readonly {
  readonly kind: StarterRingKind;
  readonly label: string;
  readonly technique: string;
  readonly effectText: string;
  readonly mainItemLabel: string;
}[] {
  const raw = offer.payload.choices;
  if (!Array.isArray(raw) || raw.length !== 4) throw new Error("invalid_ring_offer");
  const expected: readonly StarterRingKind[] = ["weapon", "fire", "defense", "healing"];
  return raw.map((choice, index) => {
    if (
      !isRecord(choice) || choice.kind !== expected[index] || typeof choice.label !== "string" ||
      typeof choice.technique !== "string" || typeof choice.effectText !== "string" ||
      typeof choice.mainItemLabel !== "string"
    ) throw new Error("invalid_ring_offer");
    return choice as unknown as {
      readonly kind: StarterRingKind;
      readonly label: string;
      readonly technique: string;
      readonly effectText: string;
      readonly mainItemLabel: string;
    };
  });
}

export async function renderCanonicalProgressionCard(
  dependencies: ProgressionCardDependencies,
  input: { readonly home: CommandResult; readonly view: TelegramRunView },
): Promise<RenderedCard | null> {
  const home = parseHome(input.home);
  if (home.playerId !== input.view.run.playerId) return null;
  const messageId = parseMessageId(input.view);

  if (input.view.run.status === "active") {
    const offer = home.pendingOffer;
    if (
      input.view.run.phase !== "blocked_by_offer" || offer?.kind !== "field_item" ||
      offer.sourceRunId !== input.view.run.id || input.view.lastResolution === null
    ) return null;
    const item = itemOfferPayload(offer);
    const catalog = STARTER_ITEM_CATALOG[item.itemKey];
    const build = parseCanonicalBuildView(home.build);
    const current = build.loadoutSnapshot.items.find((entry) => entry.slot === item.slot) ?? null;
    const resolved = renderResolvedCard({
      resolution: input.view.lastResolution as unknown as ResolutionV1,
      next: null,
      content: input.view.content,
    });
    return renderFieldItemOfferCard({
      resolvedText: resolved.text,
      itemLabel: catalog.label,
      slotLabel: item.slot === "main"
        ? "Основний предмет"
        : item.slot === "armor"
        ? "Обладунок"
        : "Талісман",
      bonusText: bonusText(catalog.bonuses),
      currentItemLabel: current?.label ?? null,
      nextStage: input.view.run.stage,
      acceptCallbackData: await prepareProfileAction(dependencies, home, messageId, {
        kind: "accept_item",
        offerId: offer.id,
      }),
      discardCallbackData: await prepareProfileAction(dependencies, home, messageId, {
        kind: "discard_item",
        offerId: offer.id,
      }),
    });
  }

  if (home.tutorialCompleted >= 1 && !home.initialTrainingResolved) {
    const options = [];
    for (const option of home.training.options) {
      options.push({
        ...option,
        effect: effectText(option),
        callbackData: await prepareProfileAction(dependencies, home, messageId, {
          kind: "buy_stat",
          stat: option.stat,
        }),
      });
    }
    const deferCallbackData = await prepareProfileAction(dependencies, home, messageId, {
      kind: "defer_stat",
    });
    return renderTrainingChoiceCard({ freeXp: home.freeXp, options, deferCallbackData });
  }

  const offer = home.pendingOffer;
  if (offer?.kind === "tutorial_item") {
    const item = itemOfferPayload(offer);
    const catalog = STARTER_ITEM_CATALOG[item.itemKey];
    const build = parseCanonicalBuildView(home.build);
    const current = build.loadoutSnapshot.items.find((entry) => entry.slot === item.slot) ?? null;
    return renderItemOfferCard({
      itemLabel: catalog.label,
      slotLabel: item.slot === "main"
        ? "Основний предмет"
        : item.slot === "armor"
        ? "Обладунок"
        : "Талісман",
      bonusText: bonusText(catalog.bonuses),
      currentItemLabel: current?.label ?? null,
      acceptCallbackData: await prepareProfileAction(dependencies, home, messageId, {
        kind: "accept_item",
        offerId: offer.id,
      }),
      discardCallbackData: await prepareProfileAction(dependencies, home, messageId, {
        kind: "discard_item",
        offerId: offer.id,
      }),
    });
  }

  if (offer?.kind === "starter_ring") {
    const choices = [];
    for (const choice of ringChoices(offer)) {
      choices.push({
        ...choice,
        callbackData: await prepareProfileAction(dependencies, home, messageId, {
          kind: "choose_ring",
          offerId: offer.id,
          ringKind: choice.kind,
        }),
      });
    }
    return renderRingOfferCard({ choices });
  }

  if (home.tutorialCompleted === 2) {
    const build = parseCanonicalBuildView(home.build);
    const hasRing = build.loadoutSnapshot.rings.length === 1;
    const masteryCallbackData = hasRing
      ? await prepareProfileAction(dependencies, home, messageId, { kind: "train_ring_mastery" })
      : undefined;
    return renderHeroCard({
      build,
      freeXp: home.freeXp,
      masteryCostXp: masteryCost(home),
      masteryCallbackData,
    });
  }

  return renderTutorialCard({
    completed: home.tutorialCompleted,
    hasActiveRun: false,
    initialTrainingResolved: home.initialTrainingResolved,
  });
}
