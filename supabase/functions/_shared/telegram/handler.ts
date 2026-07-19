import {
  deleteTelegramIdentity,
  deriveDeletionId,
  type IdentityDeletionSink,
} from "../application/delete-identity.ts";
import type { CommandResult, DatabasePort } from "../application/database-port.ts";
import { resolveChoice } from "../application/resolve-choice.ts";
import { getTelegramDeletionIdentity } from "../application/telegram-deletion-identity.ts";
import { getTelegramIdentityV2 } from "../application/telegram-identity-v2.ts";
import type { Clock } from "../infrastructure/clock.ts";
import {
  renderDeletionPrompt,
  renderDeletionRetryCard,
  renderPrivacyCard,
} from "../render/privacy.ts";
import { renderCard, type RenderedCard } from "../render/types.ts";
import { hashCallbackForActor } from "./callback-token.ts";
import { deriveDeletionCallbackToken, verifyDeletionCallbackToken } from "./deletion-callback.ts";
import type { TelegramPort } from "./port.ts";
import {
  handleCanonicalProfileCallback,
  handleHeroManagementCallback,
  openHeroManagement,
  routeCanonicalHome,
} from "./progression-router.ts";
import type { NormalizedTelegramUpdate } from "./update.ts";

export interface TelegramHandlerDependencies {
  readonly database: DatabasePort;
  readonly telegram: TelegramPort;
  readonly clock: Clock;
  readonly deletionSink: IdentityDeletionSink;
  readonly callbackKey: Uint8Array;
  readonly deletionEnabled?: boolean;
}

export interface TelegramHandlerResult {
  readonly statusCode: 200;
  readonly route: string;
}

const DELETION_PENDING_CARD = renderCard(
  [
    "Видалення ще не завершено",
    "",
    "Профіль захищено від нових змін. Надішліть /delete_me, щоб безпечно повторити завершення.",
  ].join("\n"),
);
const DELETION_COMPLETE_CARD = renderCard(
  "Зв’язок із Telegram видалено, профіль знеособлено. За бажанням ви зможете почати знову командою /start.",
);

function playerId(result: CommandResult): string | null {
  return result.status === "ok" && typeof result.playerId === "string" ? result.playerId : null;
}

function deletionConfirmedAfterError(result: CommandResult, expectedPlayerId: string): boolean {
  if (result.status === "none") return true;
  const latestPlayerId = playerId(result);
  return result.status === "ok" && latestPlayerId !== null && latestPlayerId !== expectedPlayerId;
}

function deletionPending(result: CommandResult): boolean {
  return result.status === "rejected" && result.reason === "identity_deletion_pending";
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

async function identityFor(
  dependencies: TelegramHandlerDependencies,
  externalId: bigint,
  create: boolean,
): Promise<CommandResult> {
  return await getTelegramIdentityV2(dependencies.database, {
    telegramExternalId: externalId,
    create,
  });
}

async function routeProgression(
  dependencies: TelegramHandlerDependencies,
  update: NormalizedTelegramUpdate,
  destination: "home" | "expedition" | "resume" | "hero" | "academy" | "help",
): Promise<TelegramHandlerResult> {
  const identity = await identityFor(dependencies, update.telegramExternalId, true);
  if (deletionPending(identity)) {
    await sendCard(dependencies.telegram, update.chatId, DELETION_PENDING_CARD);
    return { statusCode: 200, route: "identity_pending" };
  }
  const id = playerId(identity);
  if (id === null) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Не вдалося відкрити кабінет. Спробуйте ще раз пізніше."),
    );
    return { statusCode: 200, route: `${destination}_rejected` };
  }
  const result = await routeCanonicalHome({
    database: dependencies.database,
    telegram: dependencies.telegram,
    clock: dependencies.clock,
    callbackKey: dependencies.callbackKey,
  }, {
    playerId: id,
    chatId: update.chatId,
    updateId: update.updateId,
    destination,
  });
  return { statusCode: 200, route: result.route };
}

async function confirmDeletion(
  dependencies: TelegramHandlerDependencies,
  update: NormalizedTelegramUpdate,
  confirmationToken: string,
): Promise<TelegramHandlerResult> {
  if (dependencies.deletionEnabled === false) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Видалення буде доступне після підключення ізольованого recovery-сховища."),
    );
    return { statusCode: 200, route: "deletion_unavailable" };
  }
  const identity = await getTelegramDeletionIdentity(
    dependencies.database,
    update.telegramExternalId,
  );
  if (identity.status === "none") {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Збережених даних не знайдено."),
    );
    return { statusCode: 200, route: "deleted" };
  }
  const id = playerId(identity);
  const deletionState = identity.deletionState;
  if (
    id === null || (deletionState !== "active" && deletionState !== "deletion_pending") ||
    !await verifyDeletionCallbackToken(dependencies.callbackKey, confirmationToken, {
      telegramExternalId: update.telegramExternalId,
      playerId: id,
    })
  ) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard(
        "Це підтвердження вже не належить поточному профілю. Запустіть /delete_me ще раз.",
      ),
    );
    return { statusCode: 200, route: "deletion_rejected" };
  }
  const pendingDeletionId = identity.deletionId;
  const pendingRecordedAt = identity.deletionRequestedAt;
  const deletionId = deletionState === "active"
    ? await deriveDeletionId(id)
    : typeof pendingDeletionId === "string"
    ? pendingDeletionId
    : null;
  const recordedAt = deletionState === "active"
    ? dependencies.clock.now().toISOString()
    : typeof pendingRecordedAt === "string"
    ? pendingRecordedAt
    : null;
  if (deletionId === null || recordedAt === null) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Контекст видалення пошкоджено. Дані не змінено."),
    );
    return { statusCode: 200, route: "deletion_rejected" };
  }
  try {
    await deleteTelegramIdentity(dependencies.database, dependencies.deletionSink, {
      surrogatePlayerId: id,
      deletionId,
      recordedAt,
      attemptedAt: dependencies.clock.now().toISOString(),
    });
  } catch {
    try {
      const latestIdentity = await getTelegramDeletionIdentity(
        dependencies.database,
        update.telegramExternalId,
      );
      if (deletionConfirmedAfterError(latestIdentity, id)) {
        await sendCard(dependencies.telegram, update.chatId, DELETION_COMPLETE_CARD);
        return { statusCode: 200, route: "deleted" };
      }
    } catch {
      // A failed read cannot prove deletion; keep the retry path honest.
    }
    let retryable = true;
    try {
      await deleteTelegramIdentity(dependencies.database, dependencies.deletionSink, {
        surrogatePlayerId: id,
        deletionId,
        recordedAt,
        attemptedAt: dependencies.clock.now().toISOString(),
      });
      retryable = false;
    } catch {
      try {
        const latestIdentity = await getTelegramDeletionIdentity(
          dependencies.database,
          update.telegramExternalId,
        );
        retryable = !deletionConfirmedAfterError(latestIdentity, id);
      } catch {
        // A second failed read still cannot prove deletion.
      }
    }
    if (retryable) {
      await sendCard(
        dependencies.telegram,
        update.chatId,
        renderDeletionRetryCard(confirmationToken),
      );
      return { statusCode: 200, route: "deletion_retryable" };
    }
  }
  await sendCard(dependencies.telegram, update.chatId, DELETION_COMPLETE_CARD);
  return { statusCode: 200, route: "deleted" };
}

async function showDeletionPrompt(
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
  const identity = await getTelegramDeletionIdentity(
    dependencies.database,
    update.telegramExternalId,
  );
  const id = playerId(identity);
  if (identity.status === "none" || id === null) {
    await sendCard(
      dependencies.telegram,
      update.chatId,
      renderCard("Збережених даних не знайдено."),
    );
    return { statusCode: 200, route: "deleted" };
  }
  const token = await deriveDeletionCallbackToken(dependencies.callbackKey, {
    telegramExternalId: update.telegramExternalId,
    playerId: id,
  });
  await sendCard(dependencies.telegram, update.chatId, renderDeletionPrompt(token));
  return { statusCode: 200, route: "delete_confirmation" };
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
    await routeCanonicalHome({
      database: dependencies.database,
      telegram: dependencies.telegram,
      clock: dependencies.clock,
      callbackKey: dependencies.callbackKey,
    }, {
      playerId: id,
      chatId: update.chatId,
      updateId: update.updateId,
      destination: "resume",
    });
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
        return await routeProgression(dependencies, update, "expedition");
      case "nav:resume":
        return await routeProgression(dependencies, update, "resume");
      case "nav:menu":
      case "nav:training":
        return await routeProgression(dependencies, update, "home");
      case "nav:hero":
        return await routeProgression(dependencies, update, "hero");
      case "nav:hero-manage": {
        const identity = await identityFor(dependencies, update.telegramExternalId, false);
        const id = playerId(identity);
        if (id === null) return { statusCode: 200, route: "hero_management_rejected" };
        const result = await openHeroManagement({
          database: dependencies.database,
          telegram: dependencies.telegram,
          clock: dependencies.clock,
          callbackKey: dependencies.callbackKey,
        }, {
          playerId: id,
          chatId: update.chatId,
          messageId: update.messageId,
        });
        return { statusCode: 200, route: result.route };
      }
      case "nav:academy":
        return await routeProgression(dependencies, update, "academy");
      case "nav:help":
        return await routeProgression(dependencies, update, "help");
      case "nav:privacy":
        await sendCard(dependencies.telegram, update.chatId, renderPrivacyCard());
        return { statusCode: 200, route: "privacy" };
      case "nav:delete-confirm":
        await sendCard(
          dependencies.telegram,
          update.chatId,
          renderCard("Це застаріле підтвердження. Дані не змінено; запустіть /delete_me ще раз."),
        );
        return { statusCode: 200, route: "deletion_rejected" };
      default:
        if (update.data.startsWith("cb_")) return await handleChoice(dependencies, update);
        if (update.data.startsWith("pa_")) {
          const identity = await identityFor(dependencies, update.telegramExternalId, false);
          const id = playerId(identity);
          if (id === null) return { statusCode: 200, route: "profile_rejected" };
          const result = await handleCanonicalProfileCallback({
            database: dependencies.database,
            telegram: dependencies.telegram,
            clock: dependencies.clock,
            callbackKey: dependencies.callbackKey,
          }, { playerId: id, update });
          return { statusCode: 200, route: result.route };
        }
        if (update.data.startsWith("hm_")) {
          const identity = await identityFor(dependencies, update.telegramExternalId, false);
          const id = playerId(identity);
          if (id === null) return { statusCode: 200, route: "hero_management_rejected" };
          const result = await handleHeroManagementCallback({
            database: dependencies.database,
            telegram: dependencies.telegram,
            clock: dependencies.clock,
            callbackKey: dependencies.callbackKey,
          }, { playerId: id, update });
          return { statusCode: 200, route: result.route };
        }
        if (update.data.startsWith("del_")) {
          return await confirmDeletion(dependencies, update, update.data);
        }
        return await routeProgression(dependencies, update, "home");
    }
  }

  switch (update.command) {
    case "start":
      return await routeProgression(dependencies, update, "home");
    case "expedition":
      return await routeProgression(dependencies, update, "expedition");
    case "resume":
      return await routeProgression(dependencies, update, "resume");
    case "privacy":
      await sendCard(dependencies.telegram, update.chatId, renderPrivacyCard());
      return { statusCode: 200, route: "privacy" };
    case "delete_me":
      return await showDeletionPrompt(dependencies, update);
    case "unknown":
      return await routeProgression(dependencies, update, "home");
  }
}
