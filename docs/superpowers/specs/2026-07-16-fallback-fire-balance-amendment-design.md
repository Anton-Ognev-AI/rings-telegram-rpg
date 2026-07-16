# Fallback Fire-Ring Balance Amendment Design

**Date:** 2026-07-16

**Status:** owner-unlocked; council-reviewed (`APPROVE_WITH_SMALL_CHANGES`)

**Scope:** PHASE-04-BALANCE only

## 1. Decision

Keep the locked resolver, thresholds and starter-ring numbers unchanged. Amend the reviewed fallback
with one additional viable magical counter-route at stage 3 and correct the test simulator's
`correct` policy so it models an informed player choosing the route with the best actual margin for
their current build.

The selected content change is:

```text
s3-magical.tacticalModifier: standard -> counter
```

At ordinary baseline strength the fire build has `magical = 9`. The current route threshold is
`10`; the counter band lowers it to `9`. The physical route selected by the weapon build remains
unchanged at threshold `9`. This makes both routes viable for their intended starter build without
changing any numeric progression or combat contract.

## 2. Why This Is the Minimum Honest Change

Exhaustive read-only experiments rejected all single, double and triple edits to the four early
non-golden choices, every one-to-three physical/magical counter swap, and the simple policy-only
correction: none removed all baseline dominance. Changing ring coefficients would affect locked
progression and every later encounter; adding a real content rotation is a larger product phase.

The chosen combination produces:

- build-aware policy with current content: the exact existing baseline debt
  `weapon > fire`, `defense > fire`, `healing > fire`;
- build-aware policy plus the stage-3 magical counter-route: zero baseline dominance and zero
  full 72-cell dominance;
- no changed golden-selected choice: the pinned full run still uses `s3-physical`.

This evidence prevents the simulator correction from laundering the gate. The content change, not
the policy correction alone, must remove the imbalance.

## 3. Simulation Policy Contract

The simulator policy is test evidence, not production automation and not a claim about literal
novice behavior. `correct` means an informed, clue-respecting oracle policy:

1. consider check choices only;
2. calculate `margin = aggregate party stat - actual threshold` using read-only `CONFIG_V1`;
3. select the greatest margin;
4. break ties by original content-array order;
5. use neutral only when no check exists.

For `mixed`, even resolutions use the build-aware best check. Odd resolutions use the highest-margin
remaining check relative to that same best choice, then neutral if no alternative check exists.
`attrition` remains unchanged.

Telegram does not reveal exact thresholds before a choice, so this policy is an upper-bound balance
diagnostic. It is fair across rings because every ring uses the same rule and only its persisted
party snapshot differs.

## 4. File Boundary

Allowed:

- `content/fallback/case-001/day-01.json`;
- `scripts/simulate-starter-builds.ts`;
- `tests/unit/simulate_starter_builds_test.ts`;
- only the canonical fallback payload-hash expectation in `tests/unit/seed_content_test.ts`;
- only the matching fallback payload-hash expectation in `supabase/tests/0004_content.test.sql`;
- only the fallback SHA entry in `scripts/verify-phase4a.ts`;
- this design, the focused plan/checkpoint and project memory.

Forbidden:

- `content/schemas/dungeon-v1.schema.json`;
- resolver/config/party/combat source;
- migrations 001-014 and `supabase/migrations/SHA256SUMS`;
- golden replay input/result fixtures;
- production Telegram, database, deployment, secrets or webhook behavior.

## 5. TDD and Acceptance

Before content or simulator implementation, tests must fail for the expected old baseline debt.
The final proof must cover:

- the unpatched content view under the corrected policy still has the exact three old pairs;
- the patched fallback has `[]` for both the 24-cell baseline and 72-cell matrix;
- the matrix remains deterministic, complete, unique and terminal;
- best and alternate selection use actual resolver threshold parity and stable array-order ties;
- the schema validator and golden full-run hash
  `1d63be460b0517de00bbd2c6ce2bc34e4236992d6d16d7252d2ec210ac20a3b0` stay green;
- only the fallback byte SHA and its canonical seed/pgTAP payload-hash expectations are repinned
  after their content tests fail with the exact previous hash;
- two independent complete `verify:phase4a` runs pass.

After the checkpoint the fallback is re-locked. Remote Supabase, bot secrets, deploy and webhook
registration remain outside this phase.
