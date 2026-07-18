# Telegram Academy Game

Telegram RPG про власного учня Академії у світі книг Антона. Гравець читає підказки,
обирає підхід до випробування, проходить детерміновані бої та розвиває стати, три слоти
спорядження й магічні кільця.

Поточний статус: **Phase 4A, balance amendment і Gate 4T.0 затверджені локально**. Приватний
Telegram owner-smoke технічно підготовлений, але remote Supabase, secrets, deploy і webhook ще не
виконувалися.

## Ключові документи

- [As-built архітектура і карта змін](ARCHITECTURE.md)
- [Канонічна game-design спека v1.1](docs/specs/2026-07-12-game-design-v1.1.md)
- [Master implementation plan MVP](docs/superpowers/plans/2026-07-12-telegram-academy-mvp.md)
- [Поточний стан](PROJECT_STATE.md) і [активні задачі](TASKS.md)
- [Phase 4T owner-smoke plan](docs/superpowers/plans/2026-07-15-phase-04t-private-owner-smoke.md)
- [Локальна розробка та інциденти](docs/runbooks/local-development.md)
- [Приватний staging owner-smoke](docs/runbooks/private-owner-smoke.md)

## Непорушні принципи MVP

- Механічний outcome визначає лише код; основного RNG-кидка немає.
- Pure TypeScript resolver рахує outcome; service-only SQL RPC атомарно змінюють канонічний стан.
- Edge Functions не мають direct DML до private `game`; Telegram side effects проходять через outbox.
- **Runtime LLM заборонений:** модель не обирає outcome й не генерує персональну сцену під час прогону.
- LLM може допомагати лише в offline content pipeline; publish дозволяється після schema, rules, lore та safety validation із fallback-контентом.
- Гравець — власний учень Академії, не Макс; чорне кільце та магія плоті не використовуються.
- Інвентарю немає: три слоти спорядження, а нову річ треба одразу прийняти як заміну або викинути.
- Секрети, Telegram identifiers, токени й локальні `.env` не комітяться.

## Швидкий старт

Передумови: Node.js 20+ та запущений Docker Desktop/сумісний runtime для локального Supabase.

```powershell
npm ci
npm run verify
npm run verify:phase4a
```

Повний verifier сам запускає і зупиняє stack. Для ручної локальної роботи:

```powershell
npm run db:start
npm run supabase -- stop
```

Точні перевірені версії, localhost-only правила та recovery targets наведені в [local-development runbook](docs/runbooks/local-development.md).

## Що вже перевіряється

`npm run verify` виконує format, lint, type-check, unit і property tests. `npm run verify:phase4a`
додає clean DB reset, 338 pgTAP assertions, upgrade paths, integration/E2E Telegram сценарії,
delivery/deletion faults, 6000 callbacks, balance, reconciliation, lint і checksums.

Health endpoint повертає стабільну відповідь:

```json
{
  "status": "ok",
  "service": "telegram-academy"
}
```

## Безпека

Локальний stack призначений лише для loopback-інтерфейсу. Не відкривайте Supabase-порти в LAN/Internet і
не додавайте реальні Telegram credentials до репозиторію. Remote Supabase link, secrets, deploy, webhook або
реальний Telegram smoke вимагають окремого staging-only дозволу.
