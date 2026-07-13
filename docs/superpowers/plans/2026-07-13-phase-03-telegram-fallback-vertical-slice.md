# Phase 3 Telegram Fallback-First Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Work inline in one isolated worktree and stop at every blocking gate. Do not
> dispatch subagents unless the owner explicitly asks.

**Goal:** Build and locally verify a persisted Telegram-shaped fallback dungeon from `/start`
through stage 10 and summary, including resume, outbox delivery semantics, privacy/delete, Kyiv
grace, and P01-informed cards.

**Architecture:** A thin authenticated webhook normalizes Telegram updates into pure application
commands. Versioned service-only RPCs own all persistent mutations, while a transactional outbox
worker renders and sends/edits one canonical card through an injected Telegram port. The locked
Phase 1 resolver remains the only mechanics authority.

**Tech Stack:** TypeScript on Deno 2.9.2, grammY-compatible update adapter, Supabase/Postgres 17,
pgTAP, Web Crypto, fake Telegram/database adapters, local Edge Functions.

## Global Constraints

- Work local-only; do not link, deploy, register a webhook, load real credentials, or contact
  Telegram.
- Do not edit `CLAUDE.md`, migrations `202607120001`–`202607120008`, Phase 1 resolver/config, or the
  golden fallback mechanics.
- Database changes are forward-only in `202607130009_telegram_commands.sql` and must be
  checksum-pinned.
- `anon` and `authenticated` receive no direct table or command execution; `service_role` receives
  only exact RPC execution.
- Outbox rows contain no Telegram ID, text, username, callback token, or secret.
- Raw callback data contains no internal identifier and is at most 64 bytes.
- Use `Спритність` in Ukrainian output while retaining the internal `agility` contract.
- P01 acceptance: encounter-specific headings, post-choice stat threshold breakdown, HP/combat/XP
  deltas, visible early accumulation, and a next-day hook.

---

## Gate 3A — Service Contract Expansion

### Task 1: Failing Phase 3 database contract tests

**Files:**

- Create: `supabase/tests/0009_telegram_commands.test.sql`
- Create: `tests/integration/telegram_commands_test.ts`
- Create: `tests/integration/outbox_delivery_test.ts`

**Interfaces:**

- Consumes: existing private `game` schema and Phase 2 V1 RPCs.
- Produces: executable specifications for identity bootstrap, V2 start, run view, outbox leases, day
  lifecycle, expiry, and abandon.

- [ ] Write pgTAP assertions that migration 009 exists, all new tables have RLS, no API role has
      direct DML, and only `service_role` can execute exact Phase 3 RPC signatures.
- [ ] Assert an outbox row cannot contain PII keys and a lease cannot be completed with a different
      lease UUID.
- [ ] Write integration tests for concurrent identity bootstrap returning one player, V2 start
      returning one run/one initial outbox, and lookup-only rejecting unknown/deleted identity.
- [ ] Write outbox tests for `pending → leased → sent`, lease expiry/reclaim, bounded retry,
      `delivery_unknown` terminal hold, edit-safe retry, and stale-intent supersession.
- [ ] Write fake-time tests for spring/autumn DST, open/close/grace/closed transitions, old-run
      expiry, and explicit abandon.
- [ ] Run `npm run test:db:unit` and the focused integration tests. Expected RED: missing
      migration/RPC functions.

### Task 2: Forward migration 009

**Files:**

- Create: `supabase/migrations/202607130009_telegram_commands.sql`
- Modify: `supabase/migrations/SHA256SUMS`
- Modify: `supabase/functions/_shared/contracts/database.types.ts`

**Interfaces:**

- Produces: `telegram_identity_v1`, `start_run_v2`, `run_view_v1`, `lease_outbox_v1`,
  `complete_outbox_v1`, `publish_fallback_day_v1`, `advance_day_v1`, and `abandon_run_v1`.

- [ ] Add only the minimal transport columns/table: outbox lease UUID and retry metadata plus one
      `telegram_run_cards` record keyed by run.
- [ ] Implement idempotent identity bootstrap with row/concurrency safety and default starter stats;
      never persist username or display name in this phase.
- [ ] Implement V2 start as one transaction that validates the current Kyiv window, expires an
      overdue run if necessary, calls the existing start semantics, and inserts one initial
      `render_run_state` outbox intent.
- [ ] Implement owner-bound canonical run view returning projection, content, current
      stage/exchange, last resolution, cycle bounds, and no unrelated player's data.
- [ ] Implement `FOR UPDATE SKIP LOCKED` outbox leasing with a unique lease UUID and safe
      completion/retry/unknown transitions.
- [ ] Implement fallback-day publication and lifecycle advancement from an injected timestamp, using
      adjacent local 09:00 boundaries rather than UTC `+24h`.
- [ ] Pin owner/search path/grants for every function; update the public TypeScript function
      contract and checksum manifest.
- [ ] Run clean reset, pgTAP, focused integration/concurrency tests, database lint, reconciliation,
      and checksum verification. Expected GREEN with migrations 001–008 unchanged.
- [ ] Write `docs/checkpoints/2026-07-13-phase-03a.md`, update project memory, and commit
      `feat: add Telegram service contracts`.

---

## Gate 3B — Playable Local Telegram Slice

### Task 3: Telegram security and normalized update boundary

**Files:**

- Create: `supabase/functions/_shared/telegram/security.ts`
- Create: `supabase/functions/_shared/telegram/update.ts`
- Create: `supabase/functions/_shared/telegram/port.ts`
- Create: `supabase/functions/_shared/telegram/fake.ts`
- Create: `tests/unit/telegram_security_test.ts`
- Create: `tests/unit/telegram_update_test.ts`

**Interfaces:**

- Produces: `verifyTelegramSecret(request, expected)`, `normalizeTelegramUpdate(value)`, and
  `TelegramPort` methods `answerCallback`, `sendMessage`, and `editMessage`.

- [ ] Write RED tests for absent/wrong secret, malformed update, unsupported update, command
      extraction, callback extraction, and no sensitive error echo.
- [ ] Implement constant-work digest comparison after strict header-size validation.
- [ ] Normalize only the fields required by the application and discard the full update immediately.
- [ ] Implement a recording fake with scripted success, retryable, permanent, and delivery-unknown
      outcomes.
- [ ] Run focused tests, then full `npm run verify`.

### Task 4: Opaque deterministic callback preparation

**Files:**

- Create: `supabase/functions/_shared/telegram/callback-token.ts`
- Create: `supabase/functions/_shared/application/prepare-run-card.ts`
- Create: `tests/unit/callback_token_test.ts`
- Create: `tests/unit/prepare_run_card_test.ts`

**Interfaces:**

- Produces: deterministic HMAC-derived raw token, token SHA-256, bound context SHA-256, and prepared
  choice descriptors for one canonical run state.

- [ ] Write RED tests proving callback data is opaque, deterministic, `≤64` bytes, changes with
      state/choice/key, and does not contain UUID/stage/choice fragments.
- [ ] Write RED tests that every visible choice is resolved by the locked resolver and sent to
      `prepare_action_v1` with the stable cycle grace expiry.
- [ ] Implement Web Crypto HMAC derivation and canonical context hashing through injected key
      material.
- [ ] Map the DB run view to `PartySnapshot`, `RunStateV1`, and content choice commands without
      modifying the resolver.
- [ ] Run focused and full source verification; assert the golden hash remains unchanged.

### Task 5: P01-informed rendering

**Files:**

- Create: `supabase/functions/_shared/render/types.ts`
- Create: `supabase/functions/_shared/render/onboarding.ts`
- Create: `supabase/functions/_shared/render/menu.ts`
- Create: `supabase/functions/_shared/render/stage-card.ts`
- Create: `supabase/functions/_shared/render/summary.ts`
- Create: `tests/unit/render_test.ts`

**Interfaces:**

- Produces: Telegram-safe `RenderedCard { text, buttons }` for intro, unresolved stage, resolved
  outcome, boss exchanges, stale/resume state, and terminal summary.

- [ ] Write RED snapshot/semantic assertions for text/button limits, HTML escaping, lesson/encounter
      headings, separated clue, HP/XP, and exactly one keyboard.
- [ ] Assert outcome cards show own/companion/total/threshold, damage/healing, XP delta, combat/boss
      damage, and `Спритність` translation.
- [ ] Assert pre-choice cards do not reveal the successful route or numeric threshold.
- [ ] Assert summary shows result, deepest stage, HP, XP, strongest successful check when available,
      and the 09:00 next-day hook without pretending XP spending exists.
- [ ] Implement compact encounter-specific layouts and safe truncation within Telegram limits.
- [ ] Run render tests and `npm run verify`.

### Task 6: Pure handler and Edge composition roots

**Files:**

- Create: `supabase/functions/_shared/telegram/handler.ts`
- Create: `supabase/functions/_shared/infrastructure/supabase-rpc.ts`
- Create: `supabase/functions/tg-webhook/index.ts`
- Create: `supabase/functions/outbox-worker/index.ts`
- Create: `supabase/functions/day-publish-reset/index.ts`
- Modify: `supabase/config.toml`
- Modify: `deno.json`
- Create: `tests/unit/telegram_handler_test.ts`
- Create: `tests/unit/outbox_worker_test.ts`

**Interfaces:**

- Webhook consumes authenticated normalized updates and returns HTTP status.
- Worker consumes leased outbox intents, prepares options, renders the canonical card, sends/edits
  once, and completes the lease.

- [ ] Write RED handler tests for `/start`, expedition, resume, cached/stale/rejected callbacks,
      callback-first acknowledgement, `/privacy`, and delete confirmation routing.
- [ ] Write RED worker tests for first send, later edit, superseded intent, retryable error,
      permanent error, and delivery-unknown no-resend behavior.
- [ ] Implement the pure handler with injected database, Telegram, clock, deletion sink, and
      callback key.
- [ ] Implement fetch-based Supabase RPC adapter without exposing credentials to logs.
- [ ] Implement thin Edge entries that validate required environment names without reading secrets
      during tests.
- [ ] Set `verify_jwt = false` only for `tg-webhook`; keep worker/reset non-public.
- [ ] Extend `deno task check` with every new source entry and run full verification.

### Task 7: Persisted fake-Telegram full run

**Files:**

- Create: `tests/fixtures/telegram/start.json`
- Create: `tests/fixtures/telegram/callback.json`
- Create: `tests/e2e/fallback_solo_test.ts`
- Create: `tests/e2e/restart_resume_test.ts`

**Interfaces:**

- Consumes: real local Postgres RPCs, locked fallback content/resolver, pure handler/worker, fake
  Telegram.
- Produces: one complete deterministic transcript and durable effect counts.

- [ ] Write E2E flow that publishes a fallback day, starts a synthetic student, processes stage 1–9
      plus both boss exchanges, and reaches a terminal summary.
- [ ] Choose a legal developed test snapshot that reaches stage 10; verify stage 5 and boss-specific
      cards.
- [ ] Recreate handler/worker objects between stages to prove no in-memory state is authoritative.
- [ ] Replay one callback and submit one competing old-state callback; assert one stage result, one
      XP effect, and one card edit per state.
- [ ] Assert no fixture or log contains real Telegram data or secrets.
- [ ] Run E2E twice from clean reset, write `docs/checkpoints/2026-07-13-phase-03b.md`, update
      memory, and commit `feat: deliver local fallback dungeon`.

---

## Gate 3C — Reliability, Privacy, Lifecycle, and Load

### Task 8: Privacy and deletion flow

**Files:**

- Create: `supabase/functions/_shared/render/privacy.ts`
- Create: `tests/e2e/privacy_deletion_test.ts`
- Modify: `tests/integration/deletion_restore_test.ts`

**Interfaces:**

- Consumes: existing `deleteIdentity` orchestration and recovery-control sink.
- Produces: readable privacy notice, explicit confirmation, blocked pending identity, finalized
  unlink, and restore replay proof.

- [x] Test `/privacy` before and during a run.
- [x] Test `/delete_me` without confirmation is non-mutating and confirmation orders begin →
      tombstone → finalize.
- [x] Test sink failure leaves the player blocked and safe to retry.
- [x] Restore the primary database in isolation and replay the tombstone twice; assert the deleted
      identity does not reappear.

#### Task 8a council correction: deletion/outbox fence

Allowed scope: new forward migration/test `012`, deletion/outbox application wrappers and worker,
privacy/deletion renderer/handler, generated public RPC types, E2E helpers, Task 8 tests, checksum
manifest, and this plan. Migrations `001`–`010`, Phase 1 resolver/config/golden files, and remote
systems remain forbidden.

- [x] Begin deletion atomically blocks gameplay and supersedes queued/expired delivery intents.
- [x] A worker leases only active linked identities and re-authorizes the exact lease immediately
      before Telegram I/O; inactive work becomes superseded without a Telegram call.
- [x] Finalization refuses to unlink while a live lease exists, then succeeds with zero
      pending/leased intents after the lease drains.
- [x] Guard concurrent outbox insertion and direct identity unlink so locked V1 paths cannot bypass
      the fence; prove both lease-wins/finalize-wins outcomes.
- [x] Describe unlink/pseudonymization and retained non-PII recovery/game records accurately; test a
      forwarded deletion token against a second active identity.

### Task 9: Grace, restart, and delivery fault matrix

**Files:**

- Create: `tests/e2e/grace_expiry_test.ts`
- Create: `tests/e2e/outbox_faults_test.ts`

**Interfaces:**

- Produces: executable lifecycle and delivery state-machine proof.

- [x] Cover cycle timestamps immediately before open, at open, before close, at close, before grace
      end, and at grace end for normal, spring, and autumn cycles.
- [x] Assert a started old run resumes during grace, blocks a new run, expires after grace, and can
      be explicitly abandoned; also abandon yesterday during grace and start today immediately.
- [x] Inject `429`, `500`, timeout-before-response, timeout-after-unknown-send, permanent error, and
      edit timeout.
- [x] Assert bounded retries, no blind resend of delivery-unknown new send, safe edit retry, and
      canonical resume after every failure.

### Task 10: Load, final verification, and checkpoint

**Files:**

- Create: `scripts/load-callbacks.ts`
- Modify: `package.json`
- Modify: `deno.json`
- Create: `docs/checkpoints/2026-07-13-phase-03.md`
- Modify: `PROJECT_STATE.md`
- Modify: `TASKS.md`
- Modify: `DECISIONS.md`

**Interfaces:**

- Produces: one `verify:phase3` command and a reproducible local checkpoint.

- [x] Generate 6,000 fake callbacks across 60 independent runs without network calls; record actual
      effective throughput, acknowledgement p50/p95/p99, errors, duplicate effects and backlog.
- [x] Require effective throughput `≥10/s`, p95 `<2s`, 60/60 canonical runs, zero duplicate effects,
      zero lost outcomes, bounded queue growth and an empty final queue.
- [x] Add `verify:phase3` chaining source, Phase 2 regression, Phase 3 DB, E2E, load,
      reconciliation, lint, and checksum gates.
- [x] Run from clean reset; rerun the complete command once to detect state leakage.
- [x] Verify `git diff --check`, secret/PII scan, no remote link, unchanged locked hashes, and
      stopped local stack.
- [x] Run the final council review. Apply only in-scope fixes and rerun affected/full gates.
- [x] Record controlled deviations, remaining external gates, accumulated nonblocking
      questions/proposals, and commit `feat: complete Telegram fallback vertical slice`.

## Execution order and stop conditions

- Gate 3A blocks 3B; Gate 3B blocks 3C.
- Any checksum drift in migrations 001–008, golden hash drift, privilege exposure, duplicate
  reward/card, PII persistence, or unclassified delivery outcome stops the phase.
- A sandbox inability to access Docker may leave Gate 3A as `implemented_unverified`; it must not be
  called approved and 3B persistent E2E must not be claimed complete.
- Remote/staging work always stops for separate owner authorization even if all local gates pass.
