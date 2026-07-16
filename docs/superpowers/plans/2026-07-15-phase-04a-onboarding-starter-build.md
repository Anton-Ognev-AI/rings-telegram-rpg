# Phase 4A Onboarding and Starter Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Work inline in one isolated worktree, use `superpowers:test-driven-development`
> for every behavior change, and stop at every blocking gate. Do not dispatch subagents unless the
> owner explicitly asks.

**Goal:** Deliver and locally verify the first complete two-day retention loop: teacher-assisted
tutorial runs, one real stat purchase, one no-inventory item decision, one blue starter ring,
canonical next-run build projection, and useful Telegram-shaped profile navigation.

**Architecture:** Keep resolver `v1`, fallback content and active-run snapshots immutable. A new
expand-only migration owns normalized progression state and versioned service RPCs. Pure Phase 4
modules project builds and adapt the one tutorial rescue, application wrappers call narrow RPCs,
and focused render/router modules extend the existing Telegram boundary without moving business
logic into the handler.

**Tech Stack:** TypeScript on Deno 2.9.2, Supabase/Postgres 17, pgTAP, Web Crypto opaque callback
tokens, fake Telegram/database adapters, local Supabase CLI.

## Global Constraints

- Work only in `.worktrees/phase-04-onboarding-starter-build` on branch
  `codex/phase-04-onboarding-starter-build`.
- Do not link or contact a remote Supabase project, use Telegram credentials, deploy Edge
  Functions, register a webhook, or call the Telegram API.
- Do not edit migrations `202607120001`–`202607130013`, resolver `v1`, resolver config, fallback
  content, content schema, golden replay fixtures, or the historical `verify:phase3` command/label.
- Add schema only in `202607150014_tutorial_starter.sql`; append its checksum without changing old
  manifest entries.
- Direct Edge DML into private `game` tables remains forbidden. API roles get no table access;
  `service_role` gets only exact RPC execution.
- `start_run_v3` derives build and hashes server-side. No client-provided self/loadout snapshot is
  accepted.
- A stat, item, ring or mastery change never mutates an active run snapshot.
- No inventory, random drops, named invented teachers, vampirism, ring replacement, breakthrough,
  partnership, reminders, rank progression above `Новак`, LLM generation, Track G or public launch.
- Use `Спритність` in Ukrainian UI and `agility` in internal contracts.
- Every mutation is actor-bound, message-bound where applicable, globally update-idempotent and
  safe under concurrent duplicate callbacks.
- Preserve the existing new-send `delivery_unknown` policy.

## Gate 4.0 — Isolated Baseline

### Task 1: Create the worktree and freeze the Phase 3 baseline

**Files:**

- Create: `docs/checkpoints/2026-07-15-phase-04a-baseline.md`
- Read only: locked files listed in Global Constraints

**Interfaces:**

- Consumes: clean `main` containing the approved Phase 4 spec and plans.
- Produces: isolated branch, source hash inventory and reproducible pre-change verification.

- [x] Confirm `git status --short --branch` is clean and `.worktrees` is ignored.
- [x] Create `.worktrees/phase-04-onboarding-starter-build` from `main` on
      `codex/phase-04-onboarding-starter-build`.
- [x] Run `npm ci`, then `npm run verify`. Expected: Phase 3 source suite is green.
- [x] Run `npm run verify:phase3`. Expected: all 21 historical steps pass; remote-link guard stays
      active and local Supabase is stopped in `finally`.
- [x] Record SHA-256 values for migrations 001–013, resolver `v1`, config, schema, fallback content,
      golden replay and `scripts/verify-phase3.ts` in the baseline checkpoint.
- [x] Commit `docs: record Phase 4A baseline`.

---

## Gate 4.1 — Schema, Security and Atomic Progression

### Task 2: Write failing schema and security contracts

**Files:**

- Create: `supabase/tests/0014_tutorial_starter.test.sql`
- Create: `tests/integration/tutorial_progression_test.ts`
- Create: `tests/integration/player_action_atomicity_test.ts`
- Create: `tests/integration/player_action_concurrency_test.ts`
- Modify: `package.json`

**Interfaces:**

- Specifies: nine normalized private tables, immutable `progression-v1`, feature flag, service-only
  RPC grants, valid state transitions, unique equipment/ring ownership and global update-id locking.

```ts
type TutorialProgress = 0 | 1 | 2;
type BaseStat = "physical" | "magical" | "agility" | "vitality";
type OfferKind = "tutorial_item" | "starter_ring";
type ProfileAction =
  | { kind: "buy_stat"; stat: BaseStat }
  | { kind: "defer_stat" }
  | { kind: "accept_item" }
  | { kind: "discard_item" }
  | { kind: "choose_ring"; ring: "weapon" | "fire" | "defense" | "healing" }
  | { kind: "train_ring_mastery" };
```

- [x] Write pgTAP RED assertions for table existence, RLS, revoked table DML, immutable config,
      valid enums/checks, one item per `(player, slot)`, one starter ring, ordered offers and exact
      RPC grants.
- [x] Specify that reserved `black`, `flesh` and `vampirism` ring kinds cannot be inserted by the
      Phase 4 catalog path.
- [x] Write RED integration cases for `0/2 → 1/2 → 2/2`, natural/HP-zero/eligible-expiry credit,
      and no credit for start-only, explicit abandon or expiry below three persisted results.
- [x] Write RED atomicity cases for the `20 XP` cap-subject training grant, stat price
      `20 + 6n + 2n²`, 30-point cap, negative cap-exempt ledger entry and one profile-version bump.
- [x] Write RED races: 100 duplicate stat callbacks, competing item actions, four competing ring
      choices, and the same Telegram update racing between a run action and a profile action.
- [x] Add focused scripts `test:db:phase4a` and `test:db:phase4a:concurrency`.
- [x] Run both scripts. Expected RED: migration/RPCs are absent; no unrelated test may fail.
- [x] Commit the executable RED contracts as `test: specify Phase 4A progression contracts`.

### Task 3: Add migration 014 data model and pinned progression configuration

**Files:**

- Create: `supabase/migrations/202607150014_tutorial_starter.sql`
- Modify: `supabase/migrations/SHA256SUMS`
- Modify: `supabase/functions/_shared/contracts/database.types.ts`
- Modify: `supabase/seed.sql`

**Interfaces:**

- Produces private tables:
  `progression_config_versions`, `player_onboarding`, `player_stat_progression`,
  `tutorial_run_assignments`, `player_equipment`, `player_rings`, `player_offers`,
  `player_action_tokens`, `processed_player_actions`.
- Produces feature flag `tutorial_starter_enabled` and immutable config `progression-v1`.

```json
{
  "teacher": { "maxHp": 5, "physical": 4, "magical": 4, "agility": 4, "defense": 2 },
  "rescue": { "numerator": 1, "denominator": 2, "maxEarlierResults": 1 },
  "stat": { "baseCost": 20, "linear": 6, "quadratic": 2, "cap": 30 },
  "vitality": { "maxHpPerPoint": 4, "defenseEvery": 3 },
  "tutorialGrantXp": 20,
  "blueRing": { "combatBps": 1500, "budget": 2000, "masteryCostXp": 20 },
  "item": { "armorDefense": 2, "talismanMaxHp": 4 }
}
```

- [x] Define strict primary/foreign/unique/check constraints and timestamps; store no Telegram ID,
      username, display name, message text or secret.
- [x] Make config activation and payload/hash immutable with trigger/function protection.
- [x] Seed `progression-v1` with a canonical JSON payload and verified SHA-256; fail closed when the
      active flag/config is missing or hash-invalid. Migration 014 leaves
      `tutorial_starter_enabled=false`; only the local `supabase/seed.sql` fixture enables it.
- [x] Enable RLS and revoke all direct access, including from `service_role`.
- [x] Add only new forward SQL; never change an existing migration or checksum line.
- [x] Update public TypeScript RPC types through migration 014 while keeping private tables absent.
- [x] Run clean `npm run db:reset`, `npm run test:db:unit`, checksum verification and DB lint.
      Expected: new structural tests green and migration 001–013 hashes unchanged.
- [x] Commit `feat: add Phase 4A progression schema`.

### Task 4: Implement canonical home, identity v2 and server-derived start

**Files:**

- Continue: `supabase/migrations/202607150014_tutorial_starter.sql`
- Create: `supabase/functions/_shared/application/player-home.ts`
- Create: `supabase/functions/_shared/application/start-onboarding-run.ts`
- Create: `supabase/functions/_shared/application/telegram-identity-v2.ts`
- Create: `tests/unit/progression_application_test.ts`
- Modify: `deno.json`

**Interfaces:**

```ts
interface PlayerHome {
  readonly status: "ok";
  readonly playerId: string;
  readonly profileVersion: number;
  readonly tutorialCompleted: 0 | 1 | 2;
  readonly rank: "student" | "novice";
  readonly freeXp: number;
  readonly pendingOffer: null | { readonly id: string; readonly kind: OfferKind };
  readonly activeRunId: string | null;
  readonly lastTerminalRunId: string | null;
}

function startOnboardingRun(
  database: DatabasePort,
  input: { readonly playerId: string; readonly at: string },
): Promise<CommandResult>;
```

- [x] Write unit RED tests for exact RPC name/arguments and rejection propagation.
- [x] Implement `telegram_identity_v2` to initialize onboarding/stat rows idempotently without
      changing `telegram_identity_v1`.
- [x] Implement `player_home_v1` with pending-deletion fail-closed behavior and canonical router
      priority: item, ring, active run, tutorial-ready, ordinary-ready, terminal summary, menu.
- [x] Implement a private projection that locks the profile, reads base/purchased stats,
      equipment and ring, calculates effective self/loadout values, pins `progression-v1`, teacher
      snapshot and group max HP, then calls existing start semantics in the same transaction.
- [x] Expose `start_run_v3(player_id, at)` with no build arguments and one initial outbox intent.
- [x] Prove the first two starts use `partyMode=tutorial`, exact teacher snapshot and immutable hashes;
      the third uses the completed starter build and no teacher.
- [x] Run focused unit/integration tests. Expected GREEN.
- [x] Commit `feat: derive canonical onboarding runs`.

### Task 5: Implement tutorial assignment, rescue validation and completion credit

**Files:**

- Continue: `supabase/migrations/202607150014_tutorial_starter.sql`
- Create: `supabase/functions/_shared/progression/tutorial-adapter.ts`
- Create: `supabase/functions/_shared/progression/contracts.ts`
- Create: `tests/unit/tutorial_adapter_test.ts`
- Modify: `supabase/functions/_shared/application/prepare-run-card.ts`
- Modify: `supabase/functions/_shared/application/resolve-choice.ts`
- Modify: `supabase/functions/_shared/application/day-cycle.ts`

**Interfaces:**

```ts
interface TutorialAdapterContext {
  readonly tutorialOrdinal: 1 | 2;
  readonly rescueUsed: boolean;
  readonly earlierResultCount: number;
  readonly maxHp: number;
}

function adaptTutorialResolution(
  resolution: ResolutionV1,
  context: TutorialAdapterContext | null,
): ResolutionV1;
```

- [x] Write RED tests proving only tutorial run 1, only one lethal prepared first/second choice and
      only fewer than two earlier results can receive rescue.
- [x] Assert rescue output is nonterminal, restores `max(1, ceil(maxHp * 0.5))`, records
      `tutorial.teacherRescue` and `tutorial.teacherRestore`, and leaves ordinary resolutions
      byte-identical.
- [x] Implement `prepare_action_v2` validation against assignment/config/current result count; the
      client cannot forge or broaden the adapter.
- [x] Implement `resolve_choice_v2` as a wrapper around locked v1 mechanics plus one transaction-
      scoped advisory lock for Telegram update ID and exactly-once tutorial terminal credit.
- [x] Implement `advance_day_v2` to call v1 lifecycle and then credit only expired tutorial runs
      having at least three persisted results.
- [x] On first credit, request idempotent cap-subject training grant of 20 XP. On second credit,
      create exactly two ordered offers; do neither on abandon.
- [x] Keep `resolve_choice_v1`, `prepare_action_v1` and `advance_day_v1` unchanged.
- [x] Run tutorial adapter unit tests, progression integration and reconciliation. Expected GREEN
      with one credit/grant/offer set under replay.
- [x] Commit `feat: credit teacher-assisted tutorial runs`.

### Task 6: Implement globally idempotent profile actions

**Files:**

- Continue: `supabase/migrations/202607150014_tutorial_starter.sql`
- Create: `supabase/functions/_shared/application/player-action.ts`
- Create: `supabase/functions/_shared/telegram/player-callback-token.ts`
- Create: `tests/unit/player_callback_token_test.ts`
- Modify: `supabase/functions/_shared/contracts/database.types.ts`

**Interfaces:**

```ts
interface PreparePlayerActionInput {
  readonly playerId: string;
  readonly profileVersion: number;
  readonly messageId: string;
  readonly action: ProfileAction;
  readonly expiresAt: string;
}

interface ResolvePlayerActionInput {
  readonly actorPlayerId: string;
  readonly telegramUpdateId: bigint;
  readonly callbackMessageId: string;
  readonly tokenSha256: string;
  readonly contextSha256: string;
}
```

- [x] Write RED token tests: distinct `pa_` prefix, opaque HMAC, actor/profile/action/message binding,
      deterministic retry and `≤64` bytes.
- [x] Implement `prepare_player_action_v1` to persist only hashes, normalized action and expected
      profile/message/version binding.
- [x] Implement `resolve_player_action_v1` with the same update advisory lock as
      `resolve_choice_v2`, checks against both processed namespaces, exact actor/message/profile
      validation and cached byte-equivalent results.
- [x] Implement stat purchase/defer, item accept/discard, starter ring selection and post-tutorial
      mastery purchase atomically.
- [x] For vitality, update max HP by 4 and defense on every third purchased vitality point.
- [x] For the tutorial item choose talisman only when the first purchased stat was vitality;
      otherwise armor. Accept replaces only its slot; discard gives no XP.
- [x] Ring selection creates one ordinary blue ring, compatible main item, `investedXp=0`, budget
      2000 and policy version. Defense/healing ties choose the weapon.
- [x] Ring selection sets tutorial `2/2`, rank `Новак` and bumps profile version once.
- [x] Mastery costs 20 XP per +1% and never changes the fixed 15% blue combat modifier.
- [x] Run 100-duplicate and competing-action tests. Expected one effect, one ledger delta and one
      profile-version increment; cross-namespace replay mutates only one namespace.
- [x] Run Gate 4.1 clean reset, upgrade-from-013 fixture, pgTAP, integration, concurrency,
      reconciliation, lint and checksums.
- [x] Write `docs/checkpoints/2026-07-15-phase-04a-gate-4-1.md`, update memory and commit
      `feat: add atomic tutorial progression`.

---

## Gate 4.2 — Build Projection, Cards and Canonical Routing

### Task 7: Parse and expose the canonical starter build breakdown

**Files:**

- Create: `supabase/functions/_shared/progression/build-view.ts`
- Create: `supabase/functions/_shared/progression/catalog.ts`
- Create: `tests/unit/build_view_test.ts`

**Interfaces:**

```ts
interface CanonicalBuildView {
  readonly selfSnapshot: SelfSnapshot;
  readonly loadoutSnapshot: Readonly<Record<string, unknown>>;
  readonly breakdown: {
    readonly physical: readonly Contribution[];
    readonly magical: readonly Contribution[];
    readonly agility: readonly Contribution[];
    readonly vitality: readonly Contribution[];
    readonly defense: readonly Contribution[];
    readonly maxHp: readonly Contribution[];
  };
}
```

- [x] Treat the server projection inside migration 014 as the single mechanics authority. Extend
      the Task 4 database vectors for all four stat effects, armor/talisman, four rings, compatible
      main selection, equipment requirements and flooring.
- [x] Return the canonical projection and exact contribution breakdown from `player_home_v1` and
      `start_run_v3`; TypeScript validates/parses this result but never recomputes combat values.
- [x] In SQL project weapon ring as `floor(physicalFlat * 1.15)` only with a physical weapon; fire
      ring as `floor(magicalFlat * 1.15)` only with a focus; defense ring as
      `floor(defenseFlat * 1.15)`; healing ring as `postHeal + 1`.
- [x] Keep flat values and multipliers separately visible with exact source labels; reject malformed
      canonical breakdowns rather than inventing defaults.
- [x] Run focused unit tests and Deno check. Expected GREEN.
- [x] Commit `feat: expose canonical build breakdown`.

### Task 8: Render tutorial, offer, hero, Academy and help cards

**Files:**

- Create: `supabase/functions/_shared/render/tutorial.ts`
- Create: `supabase/functions/_shared/render/offers.ts`
- Create: `supabase/functions/_shared/render/hero.ts`
- Create: `supabase/functions/_shared/render/academy.ts`
- Create: `supabase/functions/_shared/render/help.ts`
- Modify: `supabase/functions/_shared/render/onboarding.ts`
- Modify: `supabase/functions/_shared/render/menu.ts`
- Modify: `supabase/functions/_shared/render/stage-card.ts`
- Modify: `supabase/functions/_shared/render/summary.ts`
- Create: `tests/unit/progression_render_test.ts`

**Interfaces:**

- Tutorial menu: `Навчання / Допомога`.
- Completed menu: `Експедиція / Герой / Академія / Допомога`.
- Stateful cards expose prepared opaque actions; read-only cards use static navigation callbacks.

- [x] Write RED semantic/snapshot tests for tutorial `0/2`, `1/2`, `2/2`, exact XP/stat forecast,
      item comparison, ring comparison, hero breakdown, Academy goal and help/privacy controls.
- [x] Add encounter-specific lesson headings and `full` versus `light` guidance from canonical run
      metadata; do not invent named teachers.
- [x] Explain teacher rescue separately from healing/ring arithmetic.
- [x] Keep first meaningful choice within two messages/taps and do not front-load a long manual.
- [x] Never show `Напарник`, reminders, breakthrough or other nonfunctional tabs.
- [x] Assert all text/callback limits, HTML escaping, one keyboard, and no pre-choice answer leak.
- [x] Run render tests and full `npm run verify`. Expected GREEN.
- [x] Commit `feat: render guided Academy progression`.

### Task 9: Add the focused canonical router without bloating the handler

**Files:**

- Create: `supabase/functions/_shared/telegram/progression-router.ts`
- Modify: `supabase/functions/_shared/telegram/handler.ts`
- Modify: `supabase/functions/_shared/application/process-outbox.ts`
- Modify: `supabase/functions/_shared/application/run-view.ts`
- Modify: `supabase/functions/_shared/application/request-run-render.ts`
- Modify: `tests/unit/telegram_handler_test.ts`
- Modify: `tests/unit/outbox_worker_test.ts`
- Create: `tests/unit/progression_router_test.ts`

**Interfaces:**

```ts
function routeCanonicalHome(
  dependencies: ProgressionRouterDependencies,
  input: CanonicalRouteInput,
): Promise<TelegramHandlerResult>;
```

- [x] Write RED routing tests for every priority state and for pending-deletion rejection.
- [x] Route `/start`, `/expedition`, `/resume`, static navigation and `pa_` callbacks through
      canonical `player_home_v1`; preserve `cb_` run callbacks and `del_` deletion callbacks.
- [x] Replace client-injected start build with `start_run_v3`; retain test-only injection only in
      explicit E2E helper, never the production handler dependency.
- [x] Require profile callbacks to match the canonical run-card message ID before mutation.
- [x] Extend `run_view_v2` and the outbox renderer with tutorial/guidance/pending-decision metadata.
- [x] Implement `request_run_render_v2` coalescing by run/state; cached/stale callbacks edit one
      canonical card and never create duplicate reward/profile cards.
- [x] Keep direct read-only hero/Academy/help cards compact; stateful item/ring/stat actions must
      originate from and edit the bound canonical message.
- [x] Prove retryable edit failure followed by redelivery applies no second mutation and edits the
      same message.
- [x] Run handler/router/worker tests and all Phase 3 source/E2E regressions. Expected GREEN.
- [x] Write `docs/checkpoints/2026-07-15-phase-04a-gate-4-2.md` and update memory. Commit the
      implementation checkpoint while preserving the explicit verification hold; close this item
      only after the missing runtime regression is green.

---

## Gate 4.3 — Two-Day E2E, Balance and Full Regression

**Final checkpoint (updated 2026-07-16):** Tasks 10–11 and Phase 4A are complete locally. The original
two-day/verifier commits are `f982392`, `fa096fa` and `12f48b6`; the council-corrected balance delta
is `813156a`, `acb984c` and `c62d219`. Source verification (`168 + 3`) and the 72-cell strict
pairwise matrix are green. Docker access was restored and `verify:phase4a` passed all 31 steps twice
in 525.1 s and 553.5 s. Runtime fixture corrections are committed as `1087fc4`; migration 014 is
checksum-pinned and locked. The separate baseline diagnostic still blocks Phase 4T owner-smoke. See
`docs/checkpoints/2026-07-15-phase-04a.md`.

### Task 10: Prove the two-cycle progression loop end to end

**Files:**

- Create: `tests/e2e/tutorial_two_day_test.ts`
- Create: `tests/e2e/tutorial_terminal_paths_test.ts`
- Create: `tests/e2e/starter_build_snapshot_test.ts`
- Modify: `tests/e2e/helpers/telegram-flow.ts`

**Interfaces:**

- Consumes: local Postgres RPCs, real migration 014, locked resolver/content, pure handler/worker and
  recording fake Telegram.
- Produces: canonical transcript and durable progression evidence across three run snapshots.

- [x] RED-first flow: `/start → run 1 → credit → stat/defer → next cycle → run 2 → item → ring`.
- [x] Prove tutorial progress `0/2 → 1/2 → 2/2`, rank `Новак`, and correct menus at each step.
- [x] Exercise natural terminal, HP-zero, eligible expiry, ineligible expiry, start-only and abandon.
- [x] Exercise item accept and discard paths; both must reach the ring decision.
- [x] Exercise all four ring choices and both compatible main-item branches.
- [x] Show the stat purchase affects run 2 only when bought before its start.
- [x] Show item/ring affect run 3 and earlier snapshots remain byte-identical.
- [x] Replay/cross-race stale callbacks and restart handler/worker objects between steps.
- [x] Assert ledger, tutorial, offers, profile versions, result counts, outbox and canonical card
      reconciliation are exact and contain no real identity/secret.

### Task 11: Add balance simulation and a self-contained Phase 4 verifier

**Files:**

- Create: `scripts/simulate-starter-builds.ts`
- Create: `scripts/verify-phase4a.ts`
- Create: `tests/unit/simulate_starter_builds_test.ts`
- Create: `tests/unit/verify_phase4a_test.ts`
- Modify: `package.json`
- Modify: `deno.json`

**Interfaces:**

- Simulation matrix: four rings × `correct`, `mixed`, `attrition` policies × tutorial/ordinary
  build snapshots × validated baseline/martial/arcane test-only content views.
- Verifier is local-only, refuses `supabase/.temp/project-ref`, manages isolated CLI profile and
  always stops local Supabase in `finally`.

- [x] Write RED verifier tests for remote-link refusal, non-loopback DB refusal, cleanup and the
      complete ordered command list.
- [x] Compare depth, terminal state, HP, XP and successful-check distribution for each starter ring;
      fail closed if any ring pairwise-dominates another across the complete 72-cell matrix. Keep the
      non-empty 24-cell baseline diagnostic visible as a Phase 4T blocker.
- [x] Add `verify:phase4a` without editing historical `verify:phase3` or its fixed `283 pgTAP` label.
- [x] Run Phase 4 verification twice from a clean reset. It must include Phase 3 source, database,
      concurrency, deletion, Telegram E2E, lifecycle, delivery-fault and load regressions, then all
      new Gate 4.1–4.3 groups.
- [x] Verify migration/source baseline hashes, zero remote link, zero secret/PII findings,
      reconciliation `0/0/0`, DB lint and checksum manifest.
- [x] Write `docs/checkpoints/2026-07-15-phase-04a.md` with commands, counts, timings, balance matrix,
      residual risks and exact next gate.
- [x] Update `PROJECT_STATE.md`, `TASKS.md` and `DECISIONS.md`; run project file hygiene audit without
      deleting or moving anything.
- [x] Commit `feat: complete Phase 4A starter loop`.
- [x] Invoke `superpowers:verification-before-completion` and a full project council. Phase 4A is
      approved only if every blocking finding is resolved and the repeated verifier is green.

## Phase 4A Done Definition

- Two actually played tutorial runs produce durable `0/2 → 1/2 → 2/2` progression.
- Rescue, credit, grant, offers and actions are deterministic, exactly once and concurrency-safe.
- The player can see and choose a stat, no-inventory item and blue ring that changes the third run.
- All cards are useful, honest, compact and canonical; no empty future system is shown.
- Migration 014 is forward-only, deny-by-default and checksum-pinned; locked artifacts are unchanged.
- Full local verification passes twice and no remote system, real Telegram identity or secret is
  touched.
