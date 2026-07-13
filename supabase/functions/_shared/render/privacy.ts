import { renderCard, type RenderedCard, staticButton } from "./types.ts";

export function renderPrivacyCard(): RenderedCard {
  return renderCard(
    [
      "Приватність",
      "",
      "Гра зберігає зв’язок із вашим числовим Telegram ID, внутрішній профіль і прогрес експедицій. Ім’я користувача та текст приватних повідомлень не потрібні.",
      "",
      "Команда /delete_me після окремого підтвердження відв’язує Telegram ID та знеособлює профіль. Псевдонімний прогрес і технічні записи можуть зберігатися без Telegram ID для цілісності гри. У локальних тестах дані не розгортаються у production.",
    ].join("\n"),
    [[staticButton("Повернутися", "nav:menu")]],
  );
}

export function renderDeletionPrompt(confirmData: string): RenderedCard {
  return renderCard(
    [
      "Відв’язати Telegram і знеособити профіль?",
      "",
      "Буде видалено зв’язок із Telegram ID. Псевдонімний прогрес і технічні записи залишаться без Telegram ID. Цю дію не можна скасувати.",
    ].join("\n"),
    [
      [staticButton("Так, відв’язати", confirmData)],
      [staticButton("Скасувати", "nav:menu")],
    ],
  );
}

export function renderDeletionRetryCard(confirmData: string): RenderedCard {
  return renderCard(
    [
      "Видалення ще не завершено",
      "",
      "Захисний запис уже створено, але один із кроків тимчасово не виконався. Прогрес заблоковано від змін; повторіть безпечну спробу.",
    ].join("\n"),
    [
      [staticButton("Повторити видалення", confirmData)],
      [staticButton("Приватність", "nav:privacy")],
    ],
  );
}
