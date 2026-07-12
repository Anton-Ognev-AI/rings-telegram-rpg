# Telegram Academy Game

Telegram RPG про власного учня Академії у світі книг Антона. Щодня гравці проходять спільну десятиетапну експедицію, читають видимі підказки й обирають дії; сервер детерміновано визначає success, neutral або failure за snapshot характеристик, предметів, кілець і напарника.

Поточний статус: **Phase 0 — concierge UX calibration та foundation**. Production-бота, віддаленої Supabase-бази й deployment ще немає.

## Ключові документи

- [Канонічна game-design спека v1.1](docs/specs/2026-07-12-game-design-v1.1.md)
- [Master implementation plan MVP](docs/superpowers/plans/2026-07-12-telegram-academy-mvp.md)
- [Детальний Phase 0 execution plan](docs/superpowers/plans/2026-07-12-phase-00-concierge-foundation.md)
- [Локальна розробка та інциденти](docs/runbooks/local-development.md)
- [Concierge test kit](prototypes/concierge/README.md)

## Непорушні принципи MVP

- Механічний outcome визначає лише код; основного RNG-кидка немає.
- **Runtime LLM заборонений:** модель не обирає outcome й не генерує персональну сцену під час прогону.
- LLM може допомагати лише в offline content pipeline; publish дозволяється після schema, rules, lore та safety validation із fallback-контентом.
- Гравець — власний учень Академії, не Макс; чорне кільце та магія плоті не використовуються.
- Інвентарю немає: три слоти спорядження, а нову річ треба одразу прийняти як заміну або викинути.
- Секрети, Telegram identifiers, токени й локальні `.env` не комітяться.

## Швидкий старт

Передумови: Node.js 20+, Docker-сумісний runtime для локального Supabase stack.

```powershell
npm ci
npm run verify
npx supabase start
```

Зупинка локального stack:

```powershell
npx supabase stop
```

Точні перевірені версії, localhost-only правила та recovery targets наведені в [local-development runbook](docs/runbooks/local-development.md).

## Що вже перевіряється

`npm run verify` виконує scoped format check, lint, type-check і unit tests для Edge Functions та foundation adapters. Історичні й locked Markdown-документи не переформатовуються автоматично.

Health endpoint повертає стабільну відповідь:

```json
{
  "status": "ok",
  "service": "telegram-academy"
}
```

## Безпека

Локальний stack призначений лише для loopback-інтерфейсу. Не відкривайте Supabase-порти в LAN/Internet, не link-айте remote project у Phase 0 і не додавайте реальні Telegram credentials до репозиторію.
