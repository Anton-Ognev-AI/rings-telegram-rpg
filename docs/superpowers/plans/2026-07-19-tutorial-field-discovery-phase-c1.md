# Tutorial Field Discovery C1 Implementation Plan

**Goal:** Deliver one protected, no-inventory item discovery in the first tutorial run and make an
accepted item affect the next unresolved stage without changing locked resolver/content artifacts.

**Architecture:** A pure deterministic planner defines eligibility/chance/slot selection. Forward
migration 017 persists a constrained `field_item` offer and an append-only effective self snapshot,
then versioned RPCs block/unblock the run safely. The existing outbox-owned run card renders the
offer and prepares existing secure profile-action callbacks.

## Task 1 — Deterministic discovery contract

**Files:**

- Create `supabase/functions/_shared/progression/field-discovery.ts`
- Create `tests/unit/field_discovery_test.ts`

- [ ] Write RED tests for the probability table, stage-3 pity, deterministic slot selection,
  occupied-slot preference, and ineligible contexts.
- [ ] Implement a pure planner with no database, Telegram, or random-number dependency.
- [ ] Run focused tests and commit `feat: plan protected tutorial discoveries`.

## Task 2 — Forward persistence and atomic resolution

**Files:**

- Create `supabase/migrations/202607190017_tutorial_field_discovery.sql`
- Modify `supabase/migrations/SHA256SUMS`
- Create `supabase/tests/0017_tutorial_field_discovery.test.sql`
- Create `tests/integration/tutorial_field_discovery_test.ts`
- Create `scripts/db/verify-upgrade-017.ts`
- Modify package/verifier wiring only where counts/new focused commands require it

- [ ] Add failing pgTAP/integration tests for constraints, privileges, pity creation, block fencing,
  accept/discard/replay, append-only snapshots, next-stage power, and duplicate-free tutorial reward.
- [ ] Add migration 017 with additive tables/constraints and versioned RPCs.
- [ ] Keep resolver V1 and migrations 001–016 byte-unchanged.
- [ ] Run focused DB tests, checksum verification, and upgrade-from-016 proof.
- [ ] Commit `feat: persist tutorial field discoveries`.

## Task 3 — Telegram offer and recovery path

**Files:**

- Modify application RPC adapters/types
- Modify `render/offers.ts`, `telegram/progression-router.ts`, and `application/process-outbox.ts`
- Modify their focused unit tests

- [ ] Write RED tests proving blocked runs render the stage result plus offer and prepare no stage
  choices.
- [ ] Route run/choice/player-action adapters to the new versioned RPCs.
- [ ] Render exact item comparison, no-inventory decision, and next-stage timing.
- [ ] Prove accept/discard refresh the same card, legacy tutorial offers remain unchanged, and Telegram
  failure remains recoverable through cached/outbox retry.
- [ ] Run source verification and commit `feat: deliver tutorial discoveries in Telegram`.

## Task 4 — Full gate and checkpoint

**Files:**

- Modify `TASKS.md`, `PROJECT_STATE.md`, `DECISIONS.md`
- Create `docs/checkpoints/2026-07-19-tutorial-field-discovery-c1.md`

- [ ] Run format, lint, type checks, all unit/property tests, pgTAP, focused integration, DB lint,
  migration checksums, and upgrade-from-016.
- [ ] Audit diff scope against the Phase B checkpoint and verify all locked hashes are unchanged.
- [ ] Record C1 as a partial implementation of P4T-06F2; keep general loot/rarities pending.
- [ ] Commit `docs: checkpoint tutorial field discovery c1`.

## Staging Gate

Do not deploy until Supabase CLI authentication is available again and the existing owner-only
staging preflight passes. Deploy internal functions first and webhook last; production remains
forbidden.
