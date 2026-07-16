# Multi-Archetype Starter-Ring Balance Gate Design

**Date:** 2026-07-16

**Status:** owner selected the recommended direction; written amendment pending owner review

**Scope:** Phase 4A Gate 4.3 source-only balance evidence

## 1. Decision

Replace the current single-fallback, no-global-dominance check with a three-archetype matrix and a
strict no-pairwise-dominance gate. The purpose is to prevent a starter ring from being a trap choice
while still allowing every ring to have favorable and unfavorable Academy assignments.

This amendment changes balance verification, not gameplay. It does not edit the locked fallback
content, resolver, migrations, progression numbers, item values or Telegram behavior.

## 2. Matrix

The deterministic simulation expands from 24 to 72 reports:

```text
4 starter rings × 3 choice policies × 2 party modes × 3 dungeon archetypes = 72
```

The dimensions remain:

- rings: `weapon`, `fire`, `defense`, `healing`;
- policies: `correct`, `mixed`, `attrition`;
- party modes: `tutorial`, `ordinary`.

The new archetype dimension is:

| Archetype | Purpose | Construction |
|---|---|---|
| `baseline` | Preserve the actual reviewed fallback result | Use the locked fallback content byte-for-byte |
| `martial` | Represent a day whose checks favor physical techniques | Test-only immutable projection that maps magical check affinity to physical |
| `arcane` | Represent a day whose checks favor magical techniques | Test-only immutable projection that maps physical check affinity to magical |

Only the `stat` affinity of check choices changes in the two projections. Choice IDs, thresholds,
damage, XP, tactical modifiers, encounter order, text and terminal rules remain unchanged. Each
projection must pass the existing dungeon content validator before simulation. No projected content
is published or persisted.

## 3. Report Contract

Every `StarterSimulationReport` adds an `archetype` field. Existing evidence remains unchanged:

- last completed stage;
- terminal state;
- remaining HP;
- earned XP;
- successful checks by stat;
- canonical replay hash.

The replay hash includes the archetype-derived resolutions and final state. Two complete matrix
runs must remain byte-identical, and all 72 dimension keys must be unique.

## 4. Pairwise Dominance

For one shared context `(archetype, policy, partyMode)`, ring A is no worse than ring B when all five
ordered metrics are greater than or equal:

1. completed depth;
2. terminal score (`victory > contained > active > defeated`);
3. remaining HP;
4. XP;
5. total successful checks.

Ring A dominates ring B across the matrix only when A is no worse in every one of the 18 shared
contexts and is strictly better in at least one metric in at least one context.

The blocking gate returns every `{ dominant, dominated }` pair and fails when the list is non-empty.
The previous global-dominance helper may remain as a compatibility diagnostic, but it is no longer
the Phase 4A acceptance gate.

Incomplete, duplicate or mismatched dimension sets fail closed as
`incomplete_starter_balance_matrix`; they never produce a passing balance result.

## 5. TDD and Failure Handling

Implementation follows these tests in order:

1. RED: the matrix must contain 72 unique reports and all three archetypes.
2. RED: a small synthetic report set where weapon dominates fire must return that exact pair and
   make the blocking assertion fail.
3. RED: missing or duplicate context rows must fail closed.
4. GREEN: implement immutable archetype projection and matrix expansion.
5. GREEN: implement pairwise comparison and the blocking assertion.
6. Run the real 72-cell matrix. If it reports dominance, do not weaken the comparator or alter test
   archetypes to manufacture a pass. Record the pair and request a separate gameplay-balance
   amendment before changing production numbers.
7. Keep `npm run simulate:starter` as the verifier entrypoint and print canonical reports plus the
   empty pairwise-dominance result.

Source verification can complete under the existing Docker hold. Database/E2E approval and the two
clean full `verify:phase4a` runs remain mandatory before Phase 4A approval.

## 6. Boundaries

- No remote Supabase, bot token, deploy, webhook or real identity.
- No changes to migrations 001–014 in this amendment.
- No changes to locked Phase 1 resolver, schema, fallback or golden replay.
- No new player-facing ring, item or stat value.
- No claim that three synthetic archetypes replace later generated-content and Telegram player
  validation; they are a deterministic pre-smoke safety gate.

## 7. Acceptance

The amendment is complete when:

- the 72-cell matrix is deterministic and schema-valid;
- pairwise detection is proven by a failing synthetic example;
- incomplete matrices fail closed;
- the actual starter matrix has zero dominance pairs or a separate owner-approved production
  balance amendment resolves the reported pair;
- `npm run verify` and `npm run simulate:starter` pass;
- Gate 4.3 checkpoint, plan, `PROJECT_STATE.md`, `TASKS.md` and `DECISIONS.md` record the stricter
  criterion without marking runtime verification complete.
