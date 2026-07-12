# Project State

## Project Goal
Telegram-бот гра: гравець — учень Академії у світі книг Антона; щоденна спільна 10-етапна експедиція з однією обкладинкою, детермінованими виборами (успіх / нейтрально / провал), міні-босом на етапі 5 та босом на етапі 10; розвиток героя (фізична сила, магічна сила, спритність, живучість), предметів без інвентарю й магічних грудних кілець (синє → зелене → жовте → фіолетове; чорне не використовується), а також асинхронна група з викладачем або одним взаємним напарником і денним snapshot прозорого внеску.

## Technical Context
- Language/Stack: TypeScript + grammY + Supabase (Postgres + Edge Functions webhook + pg_cron); LLM: Claude API; image-gen: TBD
- Current Phase: Phase 0 checkpoint — Docker local stack/reset/health verified; concierge session `P01` is recorded and 2–4 more independent sessions remain. Isolated worktree is selected but deferred until the human gate; Phase 0 remains `in_progress`, remote systems do not change.

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
- `docs/superpowers/plans/2026-07-12-phase-00-concierge-foundation.md`: Detailed Inline Phase 0 TDD plan (Status: in_progress)
- `prototypes/concierge/`: Validated post-tutorial concierge kit (Status: in_progress; anonymized `P01` recorded)
- `supabase/functions/health/` and `_shared/infrastructure/`: TDD Phase 0 foundation (Status: verified)
- `docs/checkpoints/2026-07-12-phase-00.md`: Current Phase 0 evidence and batched gates (Status: in_progress)

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
- Current gates: `PENDING_HUMAN` — 1/3–5 owner-led concierge sessions recorded; `SELECTED_DEFERRED` — isolated worktree `.worktrees/phase-01-domain-kernel` is created only after that gate.
- Next safe step: collect 2–4 more independent concierge sessions and anonymous aggregates; then synthesize the UX findings, reclassify `PHASE-00` for `approved`, create the Phase 1 worktree and activate `PHASE-01`.

## Important Constants/Endpoints
- Project Root: D:\Projects\TgGame

## Conflict Resolution
If information conflicts, this file is the Single Source of Truth.
