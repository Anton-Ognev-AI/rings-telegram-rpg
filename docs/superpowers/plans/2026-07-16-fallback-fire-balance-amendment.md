# PHASE-04-BALANCE Fallback Fire-Ring Amendment Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use `superpowers:test-driven-development` during
> implementation and `superpowers:verification-before-completion` before approval.

**Goal:** Remove the real fallback's fire-ring trap without changing locked gameplay numbers,
golden replay choices or production integration behavior.

**Architecture:** The production change is one non-golden fallback tactical band. The deterministic
balance simulator gains a build-aware informed-player policy that uses the same immutable resolver
configuration. A content-parameterized simulation proves the policy correction alone does not hide
the old debt. Full local verification re-pins only the authorized fallback checksum.

**Tech stack:** TypeScript, Deno tests, JSON fallback content, existing Phase 4A verifier.

## Task 1: Record the unlocked corrective boundary

**Files:**

- Create this plan and its design.
- Modify `PROJECT_STATE.md`, `TASKS.md`, `DECISIONS.md`.

1. Record the owner's exact fallback unlock and the council verdict.
2. Mark PHASE-04-BALANCE `in_progress`, not approved.
3. Commit the design/control checkpoint before behavior changes.

## Task 2: RED — specify build-aware balance evidence

**File:** `tests/unit/simulate_starter_builds_test.ts`

1. Change the patched-fallback baseline expectation to `[]`.
2. Add an unpatched-content regression that restores only `s3-magical` to `standard` in memory and
   expects the exact old three dominance pairs.
3. Add focused selection tests for actual threshold margin, best remaining mixed alternative and
   original-array-order ties.
4. Run:

   ```powershell
   npm run deno -- test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/simulate_starter_builds_test.ts
   ```

5. Confirm RED is caused by the missing content-aware API/build-aware selection and unchanged
   fallback, not a fixture or import error.

## Task 3: GREEN — implement the minimum policy and content patch

**Files:**

- Modify `scripts/simulate-starter-builds.ts`.
- Modify `content/fallback/case-001/day-01.json`.

1. Import `CONFIG_V1` read-only and compute the same threshold formula as the resolver.
2. Select checks by descending margin with stable original-array order.
3. Define mixed odd turns as the best remaining check relative to the build-aware best.
4. Allow tests to run the same complete matrix against a supplied schema-valid content value;
   keep the normal CLI on the canonical fallback.
5. Change only `s3-magical.tacticalModifier` from `standard` to `counter`.
6. Re-run the focused test until GREEN; run formatter only on touched source/test/JSON files.

## Task 4: Verify content, golden replay and locked baseline

**Files:**

- Modify only the canonical fallback payload-hash expectation in
  `tests/unit/seed_content_test.ts`.
- Modify only the matching fallback payload-hash expectation in
  `supabase/tests/0004_content.test.sql`.
- Modify only the fallback hash entry in `scripts/verify-phase4a.ts`.

1. Run the content validator, balance simulator, golden replay test and property determinism test.
2. Confirm baseline and full dominance are both `[]` and the golden full-run hash is unchanged.
3. Calculate the new canonical payload hash and fallback file SHA-256; replace only their existing
   test/verifier expectations.
4. Run source verification and confirm all forbidden files are byte-identical.
5. Commit the tested implementation.

## Task 5: Runtime gate, checkpoint and re-lock

**Files:**

- Create `docs/checkpoints/2026-07-16-phase-04-balance.md`.
- Modify `PROJECT_STATE.md`, `TASKS.md`, `DECISIONS.md`.

1. Run `npm run verify:phase4a` twice from clean local-stack starts.
2. Record exact run counts/durations, new fallback SHA, unchanged golden hash and clean Git scope.
3. Re-lock the fallback and mark PHASE-04-BALANCE approved only after both runs pass.
4. Commit the checkpoint/memory update.
5. Proceed to Phase 4T local readiness; stop before any remote action or secret use.
