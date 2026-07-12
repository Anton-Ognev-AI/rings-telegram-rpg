# Local development runbook

## Scope

Цей runbook описує лише локальний Phase 0 foundation. Він не дає дозволу link-ати remote Supabase project, створювати production Telegram webhook або деплоїти функції.

## Перевірене середовище

Станом на 2026-07-12:

- Windows + PowerShell;
- Node.js `v24.15.0` (мінімум для проєкту: `>=20`);
- npm `11.12.1`;
- Deno `2.9.2`;
- Supabase CLI `2.109.1`;
- Docker Desktop `4.81.0` / Engine `29.6.1` (Linux/amd64) перевірено для local stack; перед запуском будь-який Docker-compatible runtime має відповідати на `docker version`.

CLI встановлюються лише як project-local dev dependencies і зафіксовані в `package-lock.json` та `deno.lock`.

## Bootstrap і перевірка

```powershell
npm ci
npx deno --version
npx supabase --version
npm run verify
```

`npm run verify` має завершити scoped format check, lint, type-check і всі unit tests без зміни файлів.

## Локальний Supabase stack

Потрібен запущений Docker Desktop, Rancher Desktop або інший runtime, сумісний із Docker API.

```powershell
docker version
$env:SUPABASE_TELEMETRY_DISABLED = '1'
npx supabase start
npx supabase db reset
```

Після успішного старту Edge Function можна запустити й перевірити локально:

```powershell
npx supabase functions serve health --no-verify-jwt
Invoke-WebRequest -Uri 'http://127.0.0.1:54321/functions/v1/health' -UseBasicParsing
```

Очікуване JSON-тіло: `{"status":"ok","service":"telegram-academy"}`.

У Phase 0 `[analytics]` вимкнена в `supabase/config.toml`: локальний Vector/Logflare не потрібен для health gate і на Docker Desktop очікує окремий доступ до Docker log API. Не вмикайте незахищений Docker TCP API лише заради локального Log Explorer; повертайте Analytics тільки після окремого безпечного мережевого рішення.

Зупинка:

```powershell
npx supabase stop
```

Якщо `functions serve` повідомляє, що Docker не знайдено, хоча Docker Desktop уже готовий, відкрийте новий термінал, щоб оновився `PATH` після інсталяції. Не вмикайте Docker daemon на TCP `2375` як обхідний шлях.

## Мережеве обмеження

- На перевіреній Windows/Docker Desktop конфігурації Supabase CLI опублікував порти `54321`–`54324` на `0.0.0.0`, навіть після спроби рекомендованої custom Docker network. Вважайте стек потенційно LAN-доступним, доки `docker ps` явно не показує `127.0.0.1` bindings.
- Запускайте local stack лише у довіреній приватній мережі, використовуйте тільки synthetic data та зупиняйте його одразу після перевірки.
- Не відкривайте ці порти у Firewall/Internet без окремого рішення з безпеки.
- Не використовуйте production data у local stack.
- Не link-айте remote project у Phase 0.

## Секрети й приватність

- Не комітьте `.env`, bot token, Supabase access token, service-role key, database dump або Telegram identifiers.
- Використовуйте лише synthetic IDs у tests та `P01`…`P05` у concierge CSV.
- Локальний `prototypes/concierge/session-log.csv` ігнорується Git; перед перенесенням агрегатів видаліть PII з free text.
- У логах пропускайте records через redaction adapter; поточна Phase 0 реалізація shallow і буде розширена тестами до обробки вкладених payloads перед production.

## Performance gate для closed alpha

- Очікуваний alpha peak: `1 callback/s`.
- Обов’язковий pre-alpha gate: стабільні `10 callbacks/s` протягом `10 хвилин` на representative callback flow.
- Під час gate не допускаються duplicate rewards, lost outcomes, unbounded queue growth або помилки idempotency.
- Цей Phase 0 scaffold ще не містить callback flow чи load harness; критерій фіксується зараз, перевірка виконується в пізнішій фазі до alpha.

## Інциденти й recovery

### P0 — критичний

Повна недоступність бота, витік секрету або PII, втрата/пошкодження authoritative progression, масове дублювання нагород чи публічний доступ до local/production infrastructure.

- Негайно зупинити шкідливий шлях, відкликати скомпрометовані credentials і зберегти журнали без PII.
- Target RTO для closed alpha: `≤4 години`.
- Disaster RPO для closed alpha: `≤24 години`.

### P1 — високий

Часткова деградація без витоку й без втрати authoritative data: окрема команда, reminder, картка або non-critical read model недоступні, але прогрес можна безпечно відтворити.

- Вимкнути деградовану можливість або перейти на безпечний fallback.
- Не виправляти дані ручними ad-hoc SQL-командами без зафіксованого incident plan.

## Identity unlink і видалення

- Запит на unlink Telegram identity блокує подальше використання зв’язку негайно після підтвердження.
- Видалення персонального зв’язку та пов’язаних PII має завершитися не пізніше ніж за `24 години`.
- Агреговані безособові метрики можна зберігати лише якщо їх неможливо пов’язати назад із Telegram identity.

## Офіційні посилання

- [Deno installation](https://docs.deno.com/runtime/getting_started/installation/)
- [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config)
- [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
