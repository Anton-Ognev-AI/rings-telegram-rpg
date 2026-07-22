# Tasks

## Active Task
- [ ] ID: PHASE-04T: Private Telegram owner-smoke (Gate 4T.0 and P4T-05 staging ingress are `approved`; Gate 4T.1/P4T-06 is the only active task; migration 017 and the amended functions are deployed to owner-only staging, recovery history is aligned through 002, the bounded queue drain and fresh 34-step local Docker gate are clean, Free-plan restore-slot choreography is documented, and owner acceptance plus deletion/restore closeout remain pending; ADRs 046–073)
  - [x] P4T-00: Full council review; bind each reconciliation to its retained delivery incident, keep migration 015 reconciliation-only, and make staging tools offline by default (ADR 056)
  - [x] P4T-01: Migration 015 and `delivery_unknown` operator reconciliation (`approved` locally; 13 pgTAP and six integration paths including concurrent conflict/deletion race; ADR 058)
  - [x] P4T-01A: Forward migration 016 for current-card and profile-version render idempotency (`approved` locally; current-card cached, stale-card repair and profile-change edit are separately coalesced, upgrade 014→016 green; migration 014 remains locked; ADRs 058, 063)
  - [x] P4T-02: Owner allowlist and webhook-secret boundary (`approved` locally; secret/body/normalize/owner/adapters order and generic redaction proven; ADR 059)
  - [x] P4T-02A: Remote recovery-control deletion sink (`approved` locally; service-only idempotent RPC, fixed recovery adapter, concurrent conflict and restore paths green; ADRs 061–062)
  - [x] P4T-03: Offline fail-closed staging preflight and no-cron runner (`approved` locally; dry-run has no network/secret permission and remote execution requires a separate command plus flag; ADR 060)
  - [x] P4T-04: Staging/deletion/reconciliation runbooks, local-readiness checkpoint and final 34-step local gate (`approved` locally; tracked-set preflight scanned 266 files; fresh complete verifier exited 0; final council `APPROVE_WITH_SMALL_CHANGES`; ADR 064) → `docs/checkpoints/2026-07-15-phase-04t-local-readiness.md`
  - [x] P4T-04A: Pre-deploy amendment pins Edge Function JWT modes, exposes the disposable restore-target scope and keeps secret storage owner-operated (`approved` locally; 9-check/18-migration/270-file offline preflight and zero-call dry runner; ADR 067) → `docs/checkpoints/2026-07-18-phase-04t-pre-deploy-amendment.md`
  - [x] P4T-05: Provision isolated app/recovery staging, apply app migrations 001–016 and recovery 001–002, deploy internal functions before the owner-only webhook, and prove non-owner rejection (`approved`: authoritative CLI metadata identifies `tg-game-app-staging` as the three-function app project and `tg-game-recovery-staging` as the zero-function recovery project; required secrets are `7/7` in app and `0` in recovery; Telegram webhook uses only `message`/`callback_query`; synthetic non-owner returns `403` and identity count remains `0` before seed; remote preflight is `ready` with 9 checks, 18 migrations and 270 tracked files; config/progression/tutorial plus the hash-pinned locked fallback are active; checkpoint: `docs/checkpoints/2026-07-19-phase-04t-p4t05.md`; the disposable restore target remains intentionally deferred to the isolated P4T-06 deletion drill)
  - [ ] P4T-06: Run the real three-Kyiv-cycle private Telegram flow, record technical and product evidence, close deletion/recovery/reconciliation checks, remove or explicitly retain staging, and write the Gate 4T.1 checkpoint (`in_progress`: cycle `2026-07-19` reached owner stage 6 and produced the F1–F6 amendment; clarity Phase A, character Phase B and discovery C1 are deployed to owner-only app staging; app history is exactly 001–017, recovery history is exactly 001–002, all three app functions are active with pinned JWT modes, and the latest bounded no-cron drain is clean. No persistent runner is claimed between play windows. The next executable event is the owner's explicit `запускай тест`, after which the bounded runner is started and re-verified for that session. Owner acceptance, an encrypted pre-deletion recovery point and the isolated deletion/restore drill remain pending; checkpoints: `docs/checkpoints/2026-07-22-phase-04t-discovery-staging-deploy.md`, `docs/checkpoints/2026-07-22-phase-04t-recovery-readiness.md`)
  - [x] P4T-06R1: Prove autonomous recovery/runtime readiness without user-visible deletion (`approved staging-only`: schema-only recovery dump matched the locked table/RPC/grants; the empty recovery migration ledger was repaired to exactly 001–002 without schema/data mutation; app/recovery backup APIs were audited; an ephemeral-secret bounded day/worker drain returned `ok`, two idle polls and zero delivery failures; no persistent runner or restore target was retained; ADR 071)
  - [x] P4T-06R2: Restore the full Windows local verification path after Docker became available (`approved locally`: RED reproduced the npm wrapper's absent `supabase.exe`; the verifier now selects packaged `supabase-go.exe` through `SUPABASE_CLI_BINARY_OVERRIDE`; focused test 5/5; the complete 34-step gate exited 0 in 497.4 s and cleanup left zero TgGame containers; no locked/gameplay/migration changes; ADR 072)
  - [x] P4T-06R3: Make the isolated restore drill executable within the Free-plan two-active-project limit (`approved runbook amendment`: authoritative metadata found exactly the active app/recovery pair, three inactive projects and no target; after backup/deletion/tombstone/drain/webhook proof, pause app—not recovery—create one denylisted target, replay twice, destroy it, then optionally resume and revalidate app; no remote project mutation occurred; ADR 073)
  - [x] P4T-06R4: Re-audit the remaining autonomous boundary after recovery/quota readiness (`verified`: active worktree and remote branch match at `2a4a327`; no owner-smoke runner process remains; F2D/Phase 5+ require owner acceptance and F3 requires its separate content-publishing design, so no early runner, backup, target or creative implementation was started)
  - [x] P4T-06F0: Record the owner's first real gameplay observations from stages 1–6 without treating the owner-smoke as passed (`recorded 2026-07-19`; implementation is split below and remains design/council-gated)
  - [x] P4T-06F1: Hide inactive combat-effect rows such as `Вампіризм: +0` and `Відновлення: +0`; show an effect only after the character actually acquires the corresponding ring/item/bonus (`implemented and locally verified in owner-clarity Phase A`; positive acquired effects remain visible)
  - [ ] P4T-06F2: Design and implement between-stage discoveries so each resolved quest may lead to a meaningful bonus/item offer before continuing, while preserving three equipment slots, no inventory, immediate replace/discard and protected reward pacing
    - [x] P4T-06F2A: Full council split, C1 design/implementation plan, and deterministic first-tutorial discovery planner (`30/20/10%` at stage 1, `65/50/30%` at stage 2, stage-3 pity; exact TypeScript vectors pinned by 4/4 unit tests; commit `c832f9b`)
    - [x] P4T-06F2B: Forward migration 017, append-only effective run build, blocked-offer fencing and atomic accept/discard (`approved locally`: clean 016→017 upgrade, 21 pgTAP assertions, accept/discard integration and actor/message/context/replay guards; commit `7aeffb8`)
    - [x] P4T-06F2C: Telegram result-plus-discovery card, canonical comparison and same-card recovery (`approved locally`: no next-stage callbacks while blocked; 213 unit + 3 property tests and two full two-day Telegram E2E scenarios green; commit `e761eaa`; staging owner acceptance remains under P4T-06)
    - [ ] P4T-06F2D: Extend the proven C1 boundary to general post-tutorial rarity/smart-loot/boss-drop pacing only after owner acceptance; do not widen migration 017 retrospectively
  - [ ] P4T-06F3: Design coherent Academy story arcs: a day has a named lesson and escalating practice; later days continue with a connected field assignment (for example, an expedition into the forest) rather than unrelated scenes
  - [x] P4T-06F4: Make checks understandable before and after choice: explain that a fitting action receives an easier effective threshold and a poor approach receives a harder one; show the actual modifier/required value clearly before considering any mechanical `×2` failure rule (`implemented and locally verified`; resolution shows requirement plus margin/shortfall and a choice-metadata-backed explanation without changing resolver V1)
  - [x] P4T-06F5: Replace vague teacher advice with fixed mechanic-teaching hints that explain what to notice or which stat/approach matters without always revealing the exact winning button (`implemented and locally verified`; encounter-specific advice now teaches the invariant clue/action-fit rule)
  - [x] P4T-06F6: Add a pre-expedition character-management entry point showing all stats, current three-slot equipment, rings, acquired bonuses and unspent XP; allow deliberate XP spending there and explicitly show the balance remaining after each upgrade (`implemented and locally verified across Phases A/B`: Hero is visible during tutorial; exact three-slot/ring/bonus/free-XP state is shown; affordable canonical stat/ring upgrades use isolated replay-safe `hm_` callbacks; active snapshots remain unchanged; staging owner acceptance pending under P4T-06)

## Completed Local Phase 4 Work
- [x] ID: PHASE-04A: Implement the approved local onboarding and starter-build loop (`approved` locally; ADRs 047–053) → `docs/checkpoints/2026-07-15-phase-04a.md`
  - [x] P4A-00: Isolated worktree and repeated Phase 3 baseline → `docs/checkpoints/2026-07-15-phase-04a-baseline.md`
  - [x] P4A-41: Gate 4.1 schema, security and atomic progression (`approved` locally; ADR 049) → `docs/checkpoints/2026-07-15-phase-04a-gate-4-1.md`
  - [x] P4A-42: Gate 4.2 canonical build, cards and routing (`approved` locally; ADRs 050, 053) → `docs/checkpoints/2026-07-15-phase-04a-gate-4-2.md`
  - [x] P4A-43: Gate 4.3 two-day E2E, strict pairwise balance and repeated verifier (`approved` locally; the then-open baseline fire debt was resolved by PHASE-04-BALANCE; ADRs 051–055) → `docs/checkpoints/2026-07-15-phase-04a-gate-4-3.md`
- [x] ID: PHASE-04-BALANCE: Focused fallback balance amendment (`approved` locally; baseline/full dominance `[]`; two complete 31-step verifiers green; fallback re-locked; ADRs 054–055) → `docs/checkpoints/2026-07-16-phase-04-balance.md`
- [x] ID: ARCHITECTURE-AS-BUILT: Document the actual gameplay/content/Telegram/persistence boundaries and update the Phase-0 README before further feature expansion (`approved` locally; direct Bot API/no-cron runtime truth and migration 017+ boundary recorded; ADR 065) → `docs/checkpoints/2026-07-18-architecture-as-built.md`
- [x] ID: PRE-SMOKE-FUN-AUDIT: Add a survival-aware starter diagnostic and audit the implemented two-day Telegram loop (`approved` locally; all-neutral play loses 20–35 XP but still reaches stage 9; the owner-smoke now records depth, clarity, monotony, teacher identity and return-hook evidence; ADR 066) → `docs/checkpoints/2026-07-18-pre-smoke-fun-audit.md`

## Completed Phase 4 Planning
- [x] ID: PHASE-04-DESIGN: Supplemental Phase 4A/4T audit and design (`approved`; ADRs 046–048)
  - [x] P4-D01: Owner amended the pre-Phase-4 tester gate: test after implementation and through Telegram when feasible
  - [x] P4-D02: Focused product, architecture, reliability and execution audit
  - [x] P4-D03: Recommended private owner-only Telegram staging boundary recorded as separate Phase 4T
  - [x] P4-D04: Supplemental design written, master/v1.1-traced, self-reviewed and council-corrected
  - [x] P4-D05: Owner approved the supplemental design in writing (ADR 047)
  - [x] P4-D06: Separate detailed TDD plans for Phase 4A and locally prepared/remote-gated Phase 4T (ADR 048)

## Deferred Validation Gate
- [ ] ID: CORE-LOOP-TELEGRAM-GATE: Run the 5–10-person core-loop validation on a playable Telegram build (`deferred`, not passed or cancelled; ADR 046)

## Completed Phases
- [x] ID: PHASE-03: Telegram fallback-first vertical slice (`approved` locally; ADR 045)
  - [x] P3-01: Supplemental design, threat model, full council and detailed TDD plan
  - [x] P3-3A: Service-only Telegram identity/start/view/outbox/day RPC contracts → `docs/checkpoints/2026-07-13-phase-03a.md`
  - [x] P3-3B: Local webhook/render/worker and persisted fallback run → `docs/checkpoints/2026-07-13-phase-03b.md`
  - [x] P3-3C: Delivery/privacy/grace/load proof and repeated final gate → `docs/checkpoints/2026-07-13-phase-03.md`
- [x] ID: PHASE-02: Persistent atomic core (`approved`; ADR 041)
  - [x] P2-01: Supplemental design and council review
  - [x] P2-02: Detailed TDD implementation plan
  - [x] P2-2A: Private schema/config/player/content checkpoint
  - [x] P2-2B: Atomic XP/run/action/outbox/RPC checkpoint
  - [x] P2-2C: Deletion/recovery, checksums and final checkpoint → docs/checkpoints/2026-07-13-phase-02.md
- [x] ID: PHASE-01: Deterministic domain kernel (`approved`; ADR 037)
  - [x] P1-01: Detailed TDD implementation plan and isolated worktree → docs/superpowers/plans/2026-07-12-phase-01-deterministic-domain-kernel.md
  - [x] P1-02: Versioned content/domain contracts and fallback dungeon schema
  - [x] P1-03: Deterministic party, combat, run and daily-cycle resolvers
  - [x] P1-04: Golden/property tests and balance simulation
  - [x] P1-05: Phase 1 verification and checkpoint → docs/checkpoints/2026-07-12-phase-01.md
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
