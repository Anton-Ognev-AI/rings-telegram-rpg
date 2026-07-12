# Tasks

## Active Task
- [ ] ID: PHASE-01: Deterministic domain kernel (Inline execution)
  - [ ] P1-01: Detailed TDD implementation plan and isolated worktree (`in_progress`)
  - [ ] P1-02: Versioned content/domain contracts and fallback dungeon schema
  - [ ] P1-03: Deterministic party, combat, run and daily-cycle resolvers
  - [ ] P1-04: Golden/property tests and balance simulation
  - [ ] P1-05: Phase 1 verification and checkpoint

## Completed Phases
- [x] ID: PHASE-00: Concierge UX calibration і foundation (`approved_with_waiver`; ADR 036)
  - [x] P0-01: Detailed Phase 0 TDD execution plan → docs/superpowers/plans/2026-07-12-phase-00-concierge-foundation.md
  - [x] P0-02: Initialize valid Git repository і baseline commit (`45ee953`)
  - [x] P0-03: Concierge dungeon/session kit
  - [x] P0-04: Deno/npm/Supabase project scaffold
  - [x] P0-05: Health endpoint + fake adapters via TDD
  - [x] P0-06: Phase 0 gates
    - [x] P0-06A: Docker-independent verification і checkpoint report
    - [x] P0-06B: Docker local stack, db reset і HTTP health gate (`PASS_WITH_CONSTRAINT`: trusted-network-only local runtime)
    - [x] P0-06C: Owner stopped validation after `P01`; sample-size gate explicitly waived, residual UX risk retained (`STOPPED_WITH_WAIVER`; ADR 036)
    - [x] P0-06D: Owner chose isolated worktree `.worktrees/phase-01-domain-kernel` (`READY`)

## Completed Planning
- [x] ID: PLAN-001: Master implementation plan MVP затверджено Антоном 2026-07-12; Inline execution → docs/superpowers/plans/2026-07-12-telegram-academy-mvp.md

## Completed Design
- [x] ID: DESIGN-001: Дизайн-документ гри (спека) — v1.1 затверджена Антоном 2026-07-12 → docs/specs/2026-07-12-game-design-v1.1.md
  - [x] RESEARCH-001: Аналіз схожих проєктів (агент) → docs/research/SIMILAR_PROJECTS.md (готово 2026-07-11)
  - [x] LORE-001: Лор-дайджест з D:\BookProject (Haiku-агент) → docs/lore/LORE_CONTEXT.md (готово 2026-07-11; канонічний порядок ступенів прийнято в ADR 008)
  - [x] Дизайн затверджено Антоном 2026-07-11 (ADR 008–012)
  - [x] REVIEW-001: Retention/economy/narrative аудит v1.0 (2026-07-11) — verdict `REVISE` до PLAN-001
  - [x] REVIEW-002A: Цільова аудиторія — повний досвід без знання книг, додаткова глибина для читачів (ADR 013)
  - [x] REVIEW-002B: Рамка — власний учень Академії, не історія Макса; чорне кільце виключене (ADR 014)
  - [x] REVIEW-003: Детермінована резолюція — логіка вибору + server-side stat-threshold, без основного RNG (ADR 015)
  - [x] REVIEW-004A: Прогін завершується лише при `HP = 0`; миттєвий hard-fail скасовано (ADR 016)
  - [x] REVIEW-004B: Tutorial — 2 дні викладач у груповому слоті до етапу ~5, потім слот для друга (ADR 018)
  - [x] REVIEW-005: Без звичайного рівня; реальна сила + статусний ранг Академії + нелінійні пороги (ADR 017)
  - [x] REVIEW-006: Обрано фіксовану нелінійну експедиційну драбину для MVP (ADR 019)
  - [x] DESIGN-V11-01: Узгоджено секцію «денний прогін, наслідки виборів, HP і глибина» (ADR 020)
  - [x] TERM-001: «Ловкість» перейменовано на «Спритність» (ADR 021)
  - [x] DESIGN-V11-02: Узгоджено revised секцію «фізична/магічна сила, спритність, живучість, захист, досвід, ранги Академії та групові агрегати» (ADR 022)
  - [x] DESIGN-V11-03: Узгоджено секцію «кільця, техніки, рідкість, здобич/видалення, сумісність зі спорядженням і прориви» (ADR 023)
  - [x] DESIGN-V11-04: Узгоджено секцію «предмети, слоти спорядження, рідкість і заміна здобичі» (ADR 024)
  - [x] DESIGN-V11-05: Узгоджено секцію «наслідки виборів, відлуння і міжденна пам'ять» (ADR 025)
  - [x] DESIGN-V11-06: Узгоджено секцію «повернення в гру, нагадування, серії та comeback після пропуску» (ADR 026)
  - [x] DESIGN-V11-07: Узгоджено секцію «економіка досвіду, ціна характеристик, розвиток кілець і ранги Академії» (ADR 027; числа прототипні до симуляції)
  - [x] DESIGN-V11-08: Узгоджено секцію «група з другом, запрошення, snapshot внеску, carry, нагороди та чесне порівняння» (ADR 028; включно із запрошенням людини, яка ще не запускала гру)
  - [x] DESIGN-V11-09: Узгоджено секцію «перший запуск, дві навчальні експедиції, вибір першого кільця, progressive disclosure та Telegram-меню» (ADR 029)
  - [x] DESIGN-V11-10: Узгоджено секцію «міні-боси, бос, атестації Академії та фінал Справи тижня» (ADR 030)
  - [x] DESIGN-V11-11: Узгоджено секцію «генерація, різноманіття, валідація й fallback-контент» (ADR 031)
  - [x] DESIGN-V11-12: Узгоджено секцію «стани дня, модель даних, надійність, аналітика та тестування MVP» (ADR 032)
  - [x] DESIGN-V11-13: Зібрати, перевірити й отримати фінальне затвердження канонічної спеки v1.1 → docs/specs/2026-07-12-game-design-v1.1.md (затверджено Антоном 2026-07-12 після self-review, 3 тематичних аудитів і project-council)

## Backlog
- [ ] ID: SKILLS-001: Create first custom skill

## Done
- [x] ID: SETUP-001: Initialize project template structure (2026-04-29)
- [x] ID: PROJECT-001: Define project stack and goals (2026-07-11) — рішення в DECISIONS.md 002–007
