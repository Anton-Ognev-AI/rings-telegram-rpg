# Coupled Progression Matrix — implementation plan

Date: 2026-07-23 Task: `P4T-06F7B2 + P4T-06F8B + P4T-06F10B` Status: approved for autonomous
simulation-only implementation

## Goal

Produce deterministic evidence for HP, stat XP, ring budgets, equipment, companions and
10/12/20-stage expedition load without changing deployed mechanics.

## Scope

Create:

- `scripts/simulate-coupled-progression.ts`;
- `tests/unit/coupled_progression_matrix_test.ts`;
- one result checkpoint after verification.

Modify:

- `package.json` with one local simulation entrypoint;
- current project memory after the evidence is known.

Do not modify migrations 001–017, resolver V1/config/golden, fallback content, Telegram/Edge
Functions, staging, recovery or production.

## Phases

### 1. RED — report contract

1. Require separate `currentV1`, `candidateV2`, `economy` and `sessionLoad` sections.
2. Require deterministic, unique candidate dimension keys.
3. Require explicit provenance and unsupported higher-color healing cells.
4. Pin the early target: a 43-XP physical learner with full starter equipment and teacher reaches
   fitting stage 4, not stage 5.
5. Pin the social target: a stronger deterministic friend can open stage 6 without making a friend
   mandatory for stages 1–4.

### 2. GREEN — pure evidence harness

1. Reuse the existing real-content/resolver V1 starter matrices for current truth.
2. Build candidate snapshots from approved stat costs, item catalog, ring color bonuses and the
   canonical party aggregation formula.
3. Derive ring color from invested XP; never invent green/yellow/purple healing output.
4. Simulate candidate threshold/neutral/failure depth at caps 10, 12 and 20.
5. Add active-day horizons for one/two rings and focused/balanced stat caps.

### 3. Decision evidence

1. Compare 10/12/20 Telegram decision counts without inventing missing content reading time.
2. Emit one canonical JSON report and SHA-256 hash.
3. Fail closed on incomplete dimensions or unsupported cells represented as valid depth.
4. Run focused tests, `npm run simulate:coupled` and the full source gate.

### 4. Closeout

Record whether a V2 mechanics amendment is supported, which parameters remain unresolved, and the
next smallest design decision. Update `PROJECT_STATE.md`, `TASKS.md` and `DECISIONS.md`; commit and
push. No deployment belongs to this plan.
