import { deleteIdentity, type IdentityDeletionSink } from "../application/delete-identity.ts";
import type { CommandResult, DatabasePort } from "../application/database-port.ts";
import { resolveChoice } from "../application/resolve-choice.ts";
import { requestRunRender } from "../application/request-run-render.ts";
import { resumeRun } from "../application/resume.ts";
import { getRunView } from "../application/run-view.ts";
import { startTelegramRun } from "../application/start-telegram-run.ts";
import { getTelegramIdentity } from "../application/telegram-identity.ts";
import type { Clock } from "../infrastructure/clock.ts";
import { canonicalJson, sha256Hex } from "../domain/canonical-json.ts";
import { renderMenuCard } from "../render/menu.ts";
import { renderOnboardingCard } from "../render/onboarding.ts";
import { renderCard, type RenderedCard, staticButton } from "../render/types.ts";
import { hashCallbackForActor } from "./callback-token.ts";
import type { TelegramPort } from "./port.ts";
import type { NormalizedTelegramUpdate } from "./update.ts";

export interface StartBuild {
  readonly selfSnapshot: Readonly<Record<string, unknown>>;
  readonly loadoutSnapshot: Readonly<Record<string, unknown>>;
}

export interface TelegramHandlerDependencies {
  readonly database: DatabasePort;
  readonly telegram: TelegramPort;
  readonly clock: Clock;
  readonly deletionSink: IdentityDeletionSink;
  readonly callbackKey: Uint8Array;
  readonly startBuild?: StartBuild;
  readonly deletionEnabled?: boolean;
}

export interface TelegramHandlerResult {
  readonly statusCode: 200;
  readonly route: string;
}

const DEFAULT_LOADOUT: StartBuild["loadoutSnapshot"] = {
  partyMode: "solo",
  companion: null,
  items: [],
  rings: [],
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistedStartBuild(identity: CommandResult): StartBuild | null {
  if (!isRecord(identity.stats)) return null;
  const names = ["physical", "magical", "agility", "vitality", "defense", "maxHp"] as const;
  const values: Record<(typeof names)[number], number> = {
    physical: 0,
    magical: 0,
    agility: 0,
    vitality: 0,
    defense: 0,
    maxHp: 0,
  };
  for (const name of names) {
    const value = identity.stats[name];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    values[name] = value;
  }
  if (values.maxHp === 0) return null;
  return {
    selfSnapshot: {
      ...values,
      vampRateBps: 0,
      postHeal: 0,
    },
    loadoutSnapshot: DEFAULT_LOADOUT,
  };
}

const INVALID_BUILD_CARD = renderCard(
  "Не вдалося прочитати характеристики учня. Спробуйте ще раз пізніше.",
);

function playerId(result: CommandResult): string | null {
  return result.status === "ok" && typeof result.playerId === "string" ? result.playerId : null;
}

function activeRun(result: CommandResult): boolean {
  return result.status === "ok" && typeof result.run === "object" && result.run !== null;
}

function activeRunId(result: CommandResult): string | null {
  if (!activeRun(result) || !isRecord(result.run)) return null;
  return typeof result.run.id === "string" ? result.run.id : null;
}

function resolvedRunId(result: CommandResult): string | null {
  if (!isRecord(result.result) || !isRecord(result.result.projection)) return null;
  const run = result.result.projection.run;
  return isRecord(run) && typeof run.id === "string" ? run.id : null;
}

async function requestCanonicalCard(
  dependencies: TelegramHandlerDependencies,
  player: string,
  run: string,
  updateId: bigint,
): Promise<void> {
  await requestRunRender(dependencies.database, {
    playerId: player,
    runId: run,
    requestKey: updateId.toString(),
  });
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

async function acknowledgeCallback(telegram: TelegramPort, callbackQueryId: string): Promise<void> {
  try {
    await telegram.answerCallback({ callbackQueryId });
  } catch {
    // Callback acknowledgement is ephemeral; durable gameplay processing must continue.
  }
}

function privacyCard(): RenderedCard {
  return renderCard(
    [
      "Приватність",
      "",
      "Гра зберігає зв’язок із вашим числовим Telegram ID, внутрішній профіль і прогрес експедицій. Ім’я користувача та текст приватних повідомлень не потрібні.",
      "",
      "Команда /delete_me запускає повне видалення після окремого підтвердження. Під час локальних тестів дані не розгортаються у production.",
    ].join("\n"),
    [[staticButton("Повернутися", "nav:menu")]],
  );
}

function deletionPrompt(): RenderedCard {
  return renderCard(
    [
      "Видалити всі дані гри?",
      "",
      "Буде видалено зв’язок із Telegram ID, профіль і прогрес. Цю дію не можна скасувати.",
    ].join("\n"),
    [
      [staticButton("Так, видалити все", "nav:delete-confirm")],
      [staticButton("Скасувати", "nav:menu")],
    ],
  );
}

async function identityFor(
  dependencies: TelegramHandlerDependencies,
  externalId: bigint,
  create: boolean,
): Promise<CommandResult> {
  return await getTelegramIdentity(dependencies.database, {
    telegramExternalId: externalId,
    create,
  });
}

async function showMenu(
  dependencies: TelegramHandlerDependencies,
  update: NormalizedTelegramUpdate,
  createIdentity: boolean,
  route: string,
): Promise<TelegramHandlerResult> {
  const identity = await identityFor(dependencies, update.telegramExternalId, createIdentity);
  const id = playerId(identity);
  const resumed = id === null
    ? ({ status: "none" } as CommandResult)
    : await resumeRun(dependencies.database, id);
  const run = activeRunId(resumed);
  if (id !== null && run !== null && route === "resume") {
    await requestCanonicalCard(dependencies, id, run, update.updateId);
  }
  await sendCard(
    dependencies.telegram,
    update.chatId,
    renderMenuCard({ hasActiveRun: activeRun(resumed) }),
  );
  return { statusCode: 200, route };
}

async function startExpedition(
  dependencies: TelegramHandlerDependencies,
  update: NormalizedTelegramUpdate,
): Promise<TelegramHandlerResult> {
  const identity = await identityFor(dependencies, update.telegramExternalId, true);
  const id = playerId(identity);
  if (id === null) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Не вдалося відкрити кабінет. Спробуйте ще раз пізніше."),
    );
    return { statusCode: 200, route: "expedition_rejected" };
  }

  const build = dependencies.startBuild ?? persistedStartBuild(identity);
  if (build === null) {
    await sendCard(dependencies.telegram, update.chatId, INVALID_BUILD_CARD);
    return { statusCode: 200, route: "expedition_rejected" };
  }
  const result = await startTelegramRun(dependencies.database, {
    playerId: id,
    at: dependencies.clock.now().toISOString(),
    selfSnapshot: build.selfSnapshot,
    selfSnapshotSha256: await sha256Hex(canonicalJson(build.selfSnapshot)),
    loadoutSnapshot: build.loadoutSnapshot,
    loadoutSnapshotSha256: await sha256Hex(canonicalJson(build.loadoutSnapshot)),
  });
  if (result.status === "applied" || result.status === "cached") {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Експедицію підготовлено. Картка першого етапу вже формується."),
    );
    return { statusCode: 200, route: "expedition_started" };
  }
  await sendCard(
    dependencies.telegram,
    update.chatId,
    renderCard("Сьогоднішню експедицію зараз не можна розпочати. Перевірте активний прогін."),
  );
  return { statusCode: 200, route: "expedition_rejected" };
}

async function confirmDeletion(
  dependencies: TelegramHandlerDependencies,
  update: NormalizedTelegramUpdate,
): Promise<TelegramHandlerResult> {
  if (dependencies.deletionEnabled === false) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Видалення буде доступне після підключення ізольованого recovery-сховища."),
    );
    return { statusCode: 200, route: "deletion_unavailable" };
  }
  const identity = await identityFor(dependencies, update.telegramExternalId, false);
  const id = playerId(identity);
  if (id === null) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Збережених даних не знайдено."),
    );
    return { statusCode: 200, route: "deleted" };
  }
  await deleteIdentity(dependencies.database, dependencies.deletionSink, {
    surrogatePlayerId: id,
    deletionId: crypto.randomUUID(),
    recordedAt: dependencies.clock.now().toISOString(),
  });
  await sendCard(
    dependencies.telegram,
    update.chatId,
    renderCard("Дані гри видалено. За бажанням ви зможете почати знову командою /start."),
  );
  return { statusCode: 200, route: "deleted" };
}

async function handleChoice(
  dependencies: TelegramHandlerDependencies,
  update: Extract<NormalizedTelegramUpdate, { kind: "callback" }>,
): Promise<TelegramHandlerResult> {
  const identity = await identityFor(dependencies, update.telegramExternalId, false);
  const id = playerId(identity);
  if (id === null) return { statusCode: 200, route: "choice_rejected" };

  let hashes: Awaited<ReturnType<typeof hashCallbackForActor>>;
  try {
    hashes = await hashCallbackForActor(update.data, id);
  } catch {
    await sendCard(dependencies.telegram, update.chatId, renderCard("Цей вибір недоступний."));
    return { statusCode: 200, route: "choice_rejected" };
  }
  const result = await resolveChoice(dependencies.database, {
    ...hashes,
    telegramUpdateId: update.updateId,
    actorPlayerId: id,
  });
  if (result.status === "cached" || result.status === "stale") {
    const resumed = await resumeRun(dependencies.database, id);
    let run = resolvedRunId(result) ?? activeRunId(resumed);
    if (run === null && result.status === "stale") {
      const latest = await getRunView(dependencies.database, { playerId: id, runId: null });
      run = activeRunId(latest);
    }
    if (run !== null) {
      await requestCanonicalCard(dependencies, id, run, update.updateId);
    }
    return { statusCode: 200, route: `choice_${result.status}` };
  }
  if (result.status === "applied") return { statusCode: 200, route: "choice_applied" };
  await sendCard(
    dependencies.telegram,
    update.chatId,
    renderCard("Цей вибір уже не діє. Скористайтеся актуальною карткою експедиції."),
  );
  return { statusCode: 200, route: "choice_rejected" };
}

export async function handleTelegramUpdate(
  dependencies: TelegramHandlerDependencies,
  update: NormalizedTelegramUpdate,
): Promise<TelegramHandlerResult> {
  if (update.kind === "callback") {
    await acknowledgeCallback(dependencies.telegram, update.callbackQueryId);
    switch (update.data) {
      case "nav:expedition":
        return await startExpedition(dependencies, update);
      case "nav:resume":
        return await showMenu(dependencies, update, true, "resume");
      case "nav:menu":
        return await showMenu(dependencies, update, true, "menu");
      case "nav:privacy":
        await sendCard(dependencies.telegram, update.chatId, privacyCard());
        return { statusCode: 200, route: "privacy" };
      case "nav:delete-confirm":
        return await confirmDeletion(dependencies, update);
      default:
        if (update.data.startsWith("cb_")) return await handleChoice(dependencies, update);
        return await showMenu(dependencies, update, true, "menu");
    }
  }

  switch (update.command) {
    case "start": {
      await identityFor(dependencies, update.telegramExternalId, true);
      await sendCard(dependencies.telegram, update.chatId, renderOnboardingCard());
      return { statusCode: 200, route: "onboarding" };
    }
    case "expedition":
      return await startExpedition(dependencies, update);
    case "resume":
      return await showMenu(dependencies, update, true, "resume");
    case "privacy":
      await sendCard(dependencies.telegram, update.chatId, privacyCard());
      return { statusCode: 200, route: "privacy" };
    case "delete_me":
      await sendCard(dependencies.telegram, update.chatId, deletionPrompt());
      return { statusCode: 200, route: "delete_confirmation" };
    case "unknown":
      return await showMenu(dependencies, update, true, "menu");
  }
}
