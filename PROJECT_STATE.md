# Project State

## Project Goal
Telegram-бот гра: гравець — учень Академії у світі книг Антона; щоденна спільна 10-етапна експедиція з однією обкладинкою, детермінованими виборами (успіх / нейтрально / провал), міні-босом на етапі 5 та босом на етапі 10; розвиток героя (фізична сила, магічна сила, спритність, живучість), предметів без інвентарю й магічних грудних кілець (синє → зелене → жовте → фіолетове; чорне не використовується), а також асинхронна група з викладачем або одним взаємним напарником і денним snapshot прозорого внеску.

## Technical Context
- Language/Stack: TypeScript + grammY + Supabase (Postgres + Edge Functions webhook + pg_cron); LLM: Claude API; image-gen: TBD
- Current Phase: Phase 3 Telegram fallback-first vertical slice, Gate 3B playable local Telegram slice in isolated worktree `.worktrees/phase-03-telegram-vertical-slice`. Gate 3A is approved locally (ADR 043); no remote systems changed.

## Architecture Map
- `CLAUDE.md`: System protocol (Status: locked)
- `PROJECT_STATE.md`: Single source of truth (Status: in_progress)
- `TASKS.md`: Task tracking (Status: in_progress)
- `DECISIONS.md`: ADR log (Status: in_progress)
- `/skills`: Custom AI skills (Status: todo)
- `docs/lore/LORE_CONTEXT.md`: Лор-канон з книг для генератора квестів (Status: approved)
- `docs/research/SIMILAR_PROJECTS.md`: Аналіз схожих проєктів (Status: approved)
- `docs/specs/2026-07-11-game-design.md`: Історичний дизайн-документ v1.0 (Status: superseded; keep for history)
- `docs/specs/2026-07-12-game-design-v1.1.md`: Канонічна спека MVP v1.1 (Status: approved)
- `docs/superpowers/plans/2026-07-12-telegram-academy-mvp.md`: Master implementation plan Phase 0–10 (Status: approved)
- `docs/superpowers/plans/2026-07-12-phase-01-deterministic-domain-kernel.md`: Detailed Inline Phase 1 TDD plan (Status: approved)
- `docs/superpowers/specs/2026-07-13-phase-02-persistent-atomic-core-design.md`: Supplemental local DB/atomicity design with council-directed gates 2A/2B/2C (Status: approved for planning)
- `docs/superpowers/plans/2026-07-13-phase-02-persistent-atomic-core.md`: Detailed Phase 2 TDD plan with blocking gates 2A/2B/2C (Status: approved and completed)
- `docs/checkpoints/2026-07-13-phase-02a.md`: Private schema/access/config/player/content evidence and migration hashes (Status: approved)
- `docs/checkpoints/2026-07-13-phase-02b.md`: Atomic XP/run/action/outbox/RPC and concurrency evidence (Status: approved)
- `docs/checkpoints/2026-07-13-phase-02.md`: Final persistence/deletion/recovery/checksum evidence (Status: approved)
- `docs/superpowers/specs/2026-07-13-phase-03-telegram-fallback-vertical-slice-design.md`: Council-corrected Phase 3 design with blocking Gates 3A/3B/3C (Status: approved for autonomous local implementation)
- `docs/superpowers/plans/2026-07-13-phase-03-telegram-fallback-vertical-slice.md`: Detailed Phase 3 TDD plan (Status: approved for autonomous local execution)
- `recovery-control/` and `scripts/recovery/`: Non-PII tombstone store and restore replay tooling (Status: approved locally; production provisioning deferred)
- `supabase/migrations/SHA256SUMS`: Canonical locked migration manifest for migrations 001–009 (Status: approved; later changes require a new forward migration)
- `supabase/migrations/202607120001_foundation.sql` … `202607120004_content.sql`: Private normalized Gate 2A schema (Status: approved)
- `supabase/tests/0001_foundation_security.test.sql` … `0004_content.test.sql`: 59 pgTAP assertions (Status: approved)
- `scripts/db/`: Loopback-only DB guard, direct local pgTAP runner, content seed and checksum tooling (Status: approved for local use)
- `supabase/migrations/202607120005_xp.sql` … `202607120008_core_commands.sql`: Atomic gameplay persistence and service-only command RPCs (Status: approved)
- `supabase/functions/_shared/application/`: Approved narrow Phase 2/3A command port and wrappers (Status: approved)
- `supabase/migrations/202607130009_telegram_commands.sql`: Service-only identity/start/view/outbox/day lifecycle contract with stale-intent supersession (Status: approved and locked; ADR 043)
- `supabase/tests/0009_telegram_commands.test.sql` and Phase 3A integration tests: 31 security assertions plus 11 identity/lifecycle/outbox/concurrency scenarios (Status: approved)
- `docs/checkpoints/2026-07-13-phase-03a.md`: Gate 3A service-contract evidence (Status: approved)
- `tests/integration/`: Start/resume, tamper, lost-response, zero-XP, concurrency and reconciliation proofs (Status: approved)
- `docs/superpowers/plans/2026-07-12-phase-00-concierge-foundation.md`: Detailed Inline Phase 0 TDD plan (Status: approved_with_waiver)
- `prototypes/concierge/`: Post-tutorial concierge kit (Status: paused; anonymized `P01` recorded)
- `supabase/functions/health/` and `_shared/infrastructure/`: TDD Phase 0 foundation (Status: verified)
- `docs/checkpoints/2026-07-12-phase-00.md`: Phase 0 evidence and explicit validation waiver (Status: approved_with_waiver)
- `docs/checkpoints/2026-07-12-phase-01.md`: Deterministic kernel evidence, golden hash and simulation outputs (Status: approved)
- `content/schemas/dungeon-v1.schema.json` and `content/fallback/case-001/day-01.json`: V1 content shape and reviewed mechanical fallback (Status: approved)
- `supabase/functions/_shared/domain/`: Pure versioned resolver, party/combat helpers, canonical hash and Kyiv cycle boundary (Status: approved)

## Current Review Gate
- Базова рамка: спільний данж дня, фіксована нелінійна драбина, детермінована серверна резолюція, кільця та асинхронний напарник.
- Критичні прогалини v1.0 щодо scaling, економіки, групового carry, наслідків вибору, міжденної пам'яті, onboarding, генерації та надійності закриті ADR 015–032 й інтегровані у v1.1.
- Аудиторія підтверджена: гра самодостатня для людей, які не читали книги; читачі отримують додатковий шар упізнавання й таємниць (ADR 013).
- Наративна рамка: власний учень Академії; використовується лор світу, не сюжет Макса; чорне кільце виключене (ADR 014).
- Резолюція детермінована: гравець читає ситуацію, обирає підхід, а сервер перевіряє достатність потрібного стата; основного RNG-кидка немає (ADR 015).
- Tutorial: перші 2 дні викладач займає груповий слот, навчає механік і допомагає дійти приблизно до етапу 5; далі слот передається другові (ADR 018).
- Звичайного рівня персонажа немає: сила складається зі статів, предметів, кілець і групового внеску; ранг Академії є статусом/гейтом, а не rubber-banding; пороги глибини ростуть нелінійно (ADR 017).
- До фінального боса звичайний прогін достроково завершується лише при `HP = 0`; етап 10 дає `victory`, `contained` або `defeated`, а системний `cancelled_safety` дозволений лише для quarantine небезпечного відкритого контенту (ADR 016, 030, 032).
- Core-loop напрям: фіксована спільна 10-етапна експедиція з нелінійними порогами; без персонального scaling; endless/branching extension — лише після MVP (ADR 019).
- Секція «денний прогін, наслідки виборів, HP і глибина» затверджена: neutral коштує attrition, failure завдає важкої шкоди, але прогін триває при `HP > 0`; після вибору пояснюється підказка/перевірка (ADR 020).
- Термін «ловкість» замінено на «спритність» у всьому майбутньому дизайні (ADR 021).
- Секція «характеристики, спорядження, досвід, ранги й групові агрегати» затверджена: чотири базові стати; захист похідний; один основний слот — фізична зброя або магічний фокус; групові HP/фізична/магічна шкода сумуються з прозорим breakdown, спритність використовує найкраще значення + малу допомогу (ADR 022).
- Секція кілець затверджена: перше синє кільце обирається наприкінці tutorial; відтоді всі знайдені кільця також стартують синіми й можуть одразу замінити наявне; другий слот відкривається рангом Академії; protected RNG, рідкість окрема від кольору, одна техніка на кільце, 25% повернення вкладеного досвіду при заміні/видаленні; вампіризм — окреме рідкісне кільце з лімітованим відновленням (ADR 023).
- Секція предметів затверджена: три слоти — основний предмет, обладунок, талісман; інвентарю немає, знайдений предмет одразу замінює поточний або викидається; п'ять рідкостей, smart-loot, компактне порівняння, максимум дві пропозиції за повний прогін і мала XP-компенсація за відмову (ADR 024).
- Секція пам'яті виборів затверджена: спільна семиденна «Справа тижня», максимум два позначені same-run наслідки та одне відлуння у наступній зіграній експедиції; постійна описова Хроніка й рухомий стиль учня без силових бонусів; персональних LLM-викликів немає (ADR 025).
- Секція повернення затверджена: «Ритм Академії» та накопичувальні активні дні замість стріку з обнуленням; без login-нагород і бонусів сили; opt-in нагадування максимум раз на день з автопаузою після трьох ігнорувань; comeback без втрати прогресу та з recap (ADR 026).
- Економіка затверджена як модель із прототипними числами: денний XP-budget із 60% у перших п'яти етапах; надлінійна ціна статів і MVP-cap; багаторічні бюджети кольорів кільця з проміжними mastery-кроками; чотири ранги через заліки; мінімум 25% повернення за кільце, але втрата обмежена приблизно 30 активними днями; фінальні числа лише після симуляції (ADR 027).
- Напарництво затверджене: одна взаємна ексклюзивна пара з автоподовженням і денним snapshot, повний additive carry без mid-run активації, незалежні прогони/нагороди, окреме чесне порівняння соло й груп; invite підтримує людину, яка ще не запускала гру, але пара активується лише після її двох tutorial-експедицій із викладачем і не дає силової referral-нагороди (ADR 028).
- Onboarding/menu затверджено: коротка вступна сцена та два реальні данжі дня з навчальним шаром викладача; перший вибір за максимум два натискання, навчальний rescue від надто ранньої загибелі, гарантоване перше синє кільце після другого прогону незалежно від глибини, сумісний звичайний основний предмет, progressive disclosure і меню `2 → 4` кнопки; одна редагована картка на етап та ідемпотентні дії (ADR 029).
- Пакет «боси/атестації/фінал тижня», «генерація й контроль якості контенту» та «стани дня/дані/надійність/аналітика/тестування» затверджено з усіма рекомендованими defaults (ADR 030–032).
- Залишкові ризики не блокують review, але мають пройти gates v1.1: симуляція нелінійної драбини/кілець/carry, перевірка втоми від 10 етапів, якості контенту та directional retention на малій alpha.
- Phase 0 foundation and Docker local gate verified: reproducible npm/Deno/Supabase CLI toolchain, health Edge Function, deterministic fake adapters, scoped CI verify, `supabase start` + `db reset` + HTTP health `200`, local runbook and validated concierge kit. Optional local Analytics is disabled; no remote project was linked.
- Local-network constraint: on this Windows/Docker Desktop runtime, Supabase published ports remained `0.0.0.0`; start the stack only on a trusted private network with synthetic data and stop it after the test until a separate security decision.
- Phase 0 transition: the planned 3–5-session UX sample did not pass; the owner stopped it after `P01` and explicitly waived that sample-size gate. Findings remain directional: monotony, weak visibility of stat/combat impact, insufficient early progression, and an unclear next-day hook. They are mandatory inputs to later content/UX phases, but do not expand the Phase 1 kernel boundary (ADR 036).
- Phase 1 gate passed locally: 57 unit and 3 property tests; 1000 identical replays produce byte-identical canonical results and hashes; golden full-run hash is `1d63be460b0517de00bbd2c6ce2bc34e4236992d6d16d7252d2ec210ac20a3b0`.
- Balance evidence: synthetic early tutorial build completes stage 5 and is defeated on stage 6 with 43 XP; developed solo build wins stage 10 with 65 HP and 150 XP. These are prototype curve checks, not final balance or UX validation.
- Scope remained pure/local: no DB, migrations, Telegram, items, ring progression, generator, reminders, RNG, network calls or remote mutation. P01 monotony/progression findings remain mandatory inputs to later content/UX phases.
- Gate 3A passed from a clean reset: migrations 001–009, `73` unit + `3` property, `197` pgTAP, Phase 2's `5 + 1 + 1` integration/concurrency/deletion tests, `11` Phase 3A integration tests, reconciliation `0/0/0`, database lint, checksum verification, and diff hygiene. Stale-intent supersession, lease expiry and the ten-attempt retry budget are explicitly covered (ADR 043).
- Full five-advisor council returned `SPLIT_PHASE`: Gate 3A adds missing service-only identity/start/view/outbox/day commands through forward migration 009; Gate 3B builds the local Telegram-shaped run; Gate 3C proves delivery/privacy/grace/load behavior. Direct Edge DML into private `game` tables is forbidden.
- P01 debt is now explicit Phase 3 rendering acceptance: encounter-specific layouts, post-choice stat/threshold breakdown, HP/combat/XP deltas, visible early accumulation, and a concrete next-day hook. Named canonical teachers remain deferred until lore source verification.
- Next safe step: execute Gate 3B Tasks 3–7 through TDD: Telegram secret/update boundary, opaque callbacks, P01-informed rendering, pure handler, fake outbox worker and a complete local persisted fallback run. Do not edit migrations 001–009, change Phase 1 resolver/config/golden files, link Supabase, deploy, register Telegram webhooks, load real secrets, or invite testers.

## Important Constants/Endpoints
- Project Root: D:\Projects\TgGame

## Conflict Resolution
If information conflicts, this file is the Single Source of Truth.
