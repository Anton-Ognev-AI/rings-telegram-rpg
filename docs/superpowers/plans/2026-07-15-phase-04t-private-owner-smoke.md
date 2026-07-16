# Phase 4T Private Telegram Owner-Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for local
> preparation only. Stop at the Remote Approval Gate. Do not create/link projects, provision
> secrets, deploy, register a webhook or call Telegram until the owner explicitly approves those
> exact remote actions.

**Goal:** Prepare a reproducible, owner-only staging path that can validate the completed Phase 4A
loop through a private Telegram bot without exposing production, external testers or repository
secrets.

**Architecture:** Two isolated staging projects separate gameplay data from deletion tombstones. A
public webhook authenticates Telegram's secret header and rejects non-owner updates before identity
bootstrap. Privileged functions retain JWT plus internal-secret protection. A local no-cron runner
publishes once and polls the remote worker for a bounded owner-smoke session. Migration 015 adds only
remote-readiness corrections and explicit operator reconciliation.

**Tech Stack:** Supabase CLI/Edge Functions, Postgres 17, Deno 2.9.2, Telegram Bot API webhook,
local PowerShell-compatible smoke runner, recovery-control database.

## Global Constraints

- Phase 4T begins only after Phase 4A is locally approved.
- Local code, tests, dry runs and runbooks are authorized; every remote operation is not.
- Never paste, print, commit or chat a bot token, webhook secret, internal secret, service-role key,
  Telegram user ID or database credential.
- Use a separate staging app project, separate staging recovery project and separate private bot.
- Owner allowlist rejection occurs before identity creation and before application routing.
- No cron, external testers, production-like project ref, production data or public access.
- Migration 015 is expand-only and reconciliation-only. It must not redefine migration-014
  `request_run_render_v2`; a failing render regression stops the phase for a separate review.
- Each reconciliation targets one retained delivery incident (`delivery_incident_id` is the
  `lease_id` preserved when that attempt becomes `delivery_unknown`), not only its outbox row.
- Existing migrations/checksums and `delivery_unknown` semantics stay unchanged until an operator
  makes one explicit decision.

## Gate 4T.0 — Local Remote-Readiness Corrections

### Task 1: Specify migration 015 and operator reconciliation

**Files:**

- Create: `supabase/tests/0015_owner_smoke_readiness.test.sql`
- Create: `tests/integration/delivery_unknown_reconciliation_test.ts`
- Create: `tests/integration/render_repair_coalescing_v2_test.ts`
- Create: `supabase/migrations/202607150015_owner_smoke_readiness.sql`
- Modify: `supabase/migrations/SHA256SUMS`
- Modify: `supabase/functions/_shared/contracts/database.types.ts`

**Interfaces:**

```text
reconcile_delivery_unknown_v1(
  outbox_id,
  delivery_incident_id,
  decision = 'confirm_delivered' | 'confirm_not_delivered_and_requeue',
  telegram_message_id,
  at
) -> immutable operator result
```

- [x] RED-first pgTAP tests for `game.delivery_unknown_reconciliations`, exact five-argument RPC,
      service-role-only execute, no direct DML and immutable audit evidence keyed by
      `(outbox_id, delivery_incident_id)`.
- [x] RED-first concurrency test proving the migration-014 `request_run_render_v2` contract already
      coalesces by run/state and current cards return cached with no new outbox row. A regression
      failure stops Task 1; migration 015 never takes ownership of that RPC.
- [x] RED-first reconciliation tests: delivered requires a positive message ID and closes the row;
      not-delivered requeues once without message ID; exact replay returns the cached result;
      conflicting replay, wrong status or wrong incident are rejected with zero duplicate sends.
- [x] Under an outbox row lock, recheck active identity/deletion, current intent/state and card
      ownership. Deleted or stale intent is superseded and can never be requeued.
- [x] Prove concurrent conflicting decisions, a second delivery incident on the same re-leased
      outbox, deletion race, stale intent and existing-card behavior.
- [x] Implement migration 015 for operator reconciliation only and append only its checksum.
- [x] Run clean reset, upgrade-from-014, pgTAP, integration, reconciliation, grants/direct-DML,
      lint and checksums.
- [x] Commit `feat: add owner-smoke delivery controls` (`e175054`).

### Task 1A: Correct the separately owned current-card render regression

The RED regression proved migration 014 creates a redundant repair when
`telegram_run_cards.last_state_version >= runs.state_version`, contrary to the approved Phase 4
design. A focused second council approved a separate forward correction; migration 014 remains
byte-locked and migration 015 remains reconciliation-only.

**Files:**

- Create: `supabase/migrations/202607150016_current_card_render_cache.sql`
- Modify: `supabase/migrations/SHA256SUMS`
- Modify: `supabase/functions/_shared/contracts/database.types.ts`
- Verify: `tests/integration/render_repair_coalescing_v2_test.ts`

- [x] RED is preserved: a current card currently returns `applied` and inserts a redundant repair.
- [x] Migration 016 alone takes forward ownership of `request_run_render_v2`, returning cached
      `card_current` before any insertion when the canonical card is at or ahead of run state.
- [x] Preserve owner/active/run/card validation, stale-card one-row coalescing, safe search path,
      postgres ownership and service-role-only execute grants.
- [x] Prove migration 014 checksum/bytes are unchanged and upgrade-from-014 applies 015 then 016.
- [x] Commit `fix: cache current Telegram run cards` (this checkpoint).

### Task 2: Add owner allowlist and webhook-secret boundary

**Files:**

- Create: `supabase/functions/_shared/telegram/owner-allowlist.ts`
- Create: `tests/unit/owner_allowlist_test.ts`
- Modify: `supabase/functions/tg-webhook/index.ts`
- Modify: `tests/unit/telegram_http_test.ts`
- Modify: `tests/unit/internal_endpoints_test.ts`

**Interfaces:**

```ts
function assertOwnerAllowed(
  normalized: NormalizedTelegramUpdate,
  expectedOwnerExternalId: string,
): void;
```

- [ ] Prove Telegram secret verification happens before JSON parsing and allowlist parsing happens
      before database adapter/identity bootstrap construction.
- [ ] Export an injectable webhook handler/factory so the boundary order is directly testable with
      synthetic IDs and without constructing privileged adapters for rejected requests.
- [ ] Accept exactly one canonical positive decimal Telegram external ID from an Edge secret; reject
      missing, malformed, zero, lists/ranges and mismatches with a generic response.
- [ ] Preserve JWT plus separate internal-secret checks for worker/day functions.
- [ ] Prove logs/errors redact header values, external ID, bot token and service credentials.
- [ ] Run full source verification and Phase 4A regressions. Expected GREEN.
- [ ] Commit `feat: restrict staging webhook to owner`.

### Task 3: Build a fail-closed staging preflight and no-cron runner

**Files:**

- Create: `scripts/staging/project-policy.ts`
- Create: `scripts/staging/preflight-owner-smoke.ts`
- Create: `scripts/staging/run-owner-smoke.ts`
- Create: `tests/unit/staging_project_policy_test.ts`
- Create: `tests/unit/owner_smoke_runner_test.ts`
- Modify: `package.json`
- Modify: `deno.json`

**Interfaces:**

```text
npm run staging:preflight -- --staging --project-ref <exact-ref>
npm run staging:owner-smoke -- --staging --project-ref <exact-ref> [--execute-remote]
```

- [ ] Both commands are offline/dry-run by default. Network access is impossible unless a future
      approved invocation supplies `--execute-remote`.
- [ ] Read the allowed staging project ref only from explicit local CLI input plus a local
      non-repository confirmation source; never infer it from production or Git state.
- [ ] In remote mode, require the exact CLI project ref to match the non-repository confirmation
      value; never read or print `.env` or any credential.
- [ ] Refuse absent `--staging`, unknown/project-ref mismatch, production-like denylist entries,
      dirty migration order/checksums, missing Phase 4 flags, repository secrets or a linked
      different project.
- [ ] Runner publishes/opens fallback day once through the internal endpoint, then calls the remote
      worker every two seconds until Ctrl+C; it does not advance/reset the day repeatedly.
- [ ] Print only redacted aggregate status/counts and exit nonzero on auth/project mismatch.
- [ ] Unit-test HTTP through an injected fake; no test may require network or credentials.
- [ ] Run dry-run preflight/runner tests and full local verification.
- [ ] Commit `feat: add guarded owner-smoke runner`.

### Task 4: Write staging deployment, deletion and rollback runbooks

**Files:**

- Create: `docs/runbooks/private-owner-smoke.md`
- Create: `docs/runbooks/delivery-unknown-reconciliation.md`
- Create: `docs/runbooks/staging-deletion-recovery.md`
- Create: `docs/checkpoints/2026-07-15-phase-04t-local-readiness.md`

**Interfaces:**

- Runbooks use placeholders such as `<STAGING_APP_REF>` and secret names only; never secret values.
- Every command identifies its target project and verification/rollback step.

- [ ] Document exact order: create/link app staging, create/link recovery staging, apply migrations
      014, 015 and 016,
      provision secrets, deploy internal functions, deploy webhook, register webhook, run preflight,
      run smoke, remove webhook/rotate token.
- [ ] Document an authenticated synthetic non-owner webhook request before `/start` and identity
      count proof after it; the owner does not need a second Telegram account.
- [ ] Document `delivery_unknown` evidence gathering and the two explicit operator decisions; forbid
      blind retry.
- [ ] Document isolated backup restore plus tombstone replay and proof that deleted Telegram identity
      is not restored.
- [ ] Document rollback: disable new starts, reconcile/drain one owner profile, revert function build,
      keep expanded tables, remove webhook or rotate bot token.
- [ ] Run secret/PII scan, checksum verification and documentation link audit.
- [ ] Update project memory and commit `docs: prepare private owner smoke`.

---

## Remote Approval Gate — Mandatory Stop

Stop and request one explicit owner approval immediately before any of these actions:

- create or link either staging project;
- create/use the private bot or enter its token;
- apply migration 014 or 015 remotely;
- set Edge secrets;
- deploy Edge Functions;
- register/change a Telegram webhook;
- invoke the real remote smoke runner.

Approval must identify staging-only scope. Secret values are entered directly through the local CLI
or dashboard and never through the conversation.

---

## Gate 4T.1 — Remote Owner-Smoke (Execute Only After Approval)

### Task 5: Provision isolated staging and deploy with evidence

- [ ] Run preflight against exact app/recovery refs; capture only redacted statuses and migration
      versions.
- [ ] Apply migration 014, 015 then 016 with `tutorial_starter_enabled` initially disabled.
- [ ] Provision recovery sink and perform isolated backup-restore/tombstone replay smoke.
- [ ] Set bot/webhook/internal/owner secrets through secret storage.
- [ ] Deploy internal functions first, verify JWT/internal-secret rejection, then deploy webhook.
- [ ] Register webhook with Telegram secret token, enable the owner cohort and verify a non-owner
      update creates no identity.

### Task 6: Complete and close the owner-only Telegram smoke

- [ ] Start the local no-cron runner and keep the machine on for the session.
- [ ] Complete `/start → tutorial 1 → stat/defer → tutorial 2 → item → ring` as the owner.
- [ ] Verify restart/resume, one stale callback, one retryable edit and one controlled
      `delivery_unknown` drill.
- [ ] Verify `/privacy` and `/delete_me`, then restore backup and replay tombstone to prove identity
      stays deleted.
- [ ] End with ledger/tutorial/offers/outbox reconciliation at zero mismatch.
- [ ] Remove webhook or rotate the bot token unless the owner explicitly keeps staging active.
- [ ] Record redacted evidence in `docs/checkpoints/2026-07-15-phase-04t.md`, update ADR/state/tasks
      and commit the checkpoint.
- [ ] Run `superpowers:verification-before-completion` and final council review before scheduling the
      deferred 5–10-person validation.

## Phase 4T Done Definition

- Local readiness tests and runbooks are complete before remote approval.
- Staging is isolated, owner-only and recoverable; non-owner ingress creates no identity.
- The owner completes the full Phase 4A progression through real Telegram with canonical resume and
  delivery recovery.
- No secret/real identity enters Git, logs, analytics, outbox payloads or chat.
- Staging is closed safely or intentionally retained, and only then may the external tester gate be
  scheduled.
