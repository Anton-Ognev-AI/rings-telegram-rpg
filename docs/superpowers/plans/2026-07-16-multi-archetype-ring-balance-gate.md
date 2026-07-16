# Multi-Archetype Starter-Ring Balance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the starter-ring simulator to 72 deterministic contexts and fail closed when any
starter ring pairwise-dominates another across the complete matrix.

**Architecture:** Keep the locked fallback and resolver immutable. Build three validated in-memory
content views inside the existing simulation script, add the archetype to each report, validate the
complete dimension set before comparison, and expose full-matrix plus baseline-only diagnostics
through the existing `simulate:starter` entrypoint.

**Tech Stack:** Deno 2.9, TypeScript, existing dungeon validator and V1 resolver, `@std/assert`.

## Global Constraints

- Modify only `scripts/simulate-starter-builds.ts`,
  `tests/unit/simulate_starter_builds_test.ts`, focused plans/checkpoints and project memory.
- Do not modify migrations 001–014, migration checksums, Telegram code, the locked resolver, schema,
  fallback content or golden replay.
- Do not use remote Supabase, secrets, real Telegram identity, deploy or webhooks.
- All implementation changes use RED → GREEN → REFACTOR and receive a focused commit.
- The Docker verification hold remains explicit; source success cannot approve Phase 4A.

---

### Task 1: Add validated archetype projections and a 72-cell report matrix

**Files:**

- Modify: `tests/unit/simulate_starter_builds_test.ts:1-23`
- Modify: `scripts/simulate-starter-builds.ts:1-194`

**Interfaces:**

- Consumes: locked `DungeonContentV1`, `validateDungeonContentV1`, existing `resolveAndHash`.
- Produces:
  `StarterArchetype = "baseline" | "martial" | "arcane"`,
  `StarterSimulationReport.archetype`, and 72 reports from `simulateStarterBuildMatrix()`.

- [x] **Step 1: Write the failing matrix-shape test**

Replace the first unit test with assertions that run the real simulator twice, require 72 reports,
three archetypes, terminal results and 72 unique dimension keys:

```ts
Deno.test("starter balance matrix covers 72 unique terminal archetype contexts", async () => {
  const first = await simulateStarterBuildMatrix();
  const second = await simulateStarterBuildMatrix();
  assertEquals(first, second);
  assertEquals(first.length, 72);
  assertEquals(
    new Set(first.map((report) => report.archetype)),
    new Set(["baseline", "martial", "arcane"]),
  );
  assertEquals(first.every((report) => report.terminal !== null), true);
  assertEquals(
    new Set(first.map((report) =>
      `${report.archetype}:${report.partyMode}:${report.policy}:${report.ring}`
    )).size,
    72,
  );
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```text
npm run deno -- test tests/unit/simulate_starter_builds_test.ts
```

Expected: FAIL because reports have no `archetype` and the matrix length is 24.

- [x] **Step 3: Add the minimal archetype projection**

Import `validateDungeonContentV1`, add the type/dimension, and project every ordinary and boss choice
without mutating the imported fallback:

```ts
export type StarterArchetype = "baseline" | "martial" | "arcane";

const archetypes: readonly StarterArchetype[] = ["baseline", "martial", "arcane"];

function projectedStat(stat: Stat | undefined, archetype: StarterArchetype): Stat | undefined {
  if (archetype === "martial" && stat === "magical") return "physical";
  if (archetype === "arcane" && stat === "physical") return "magical";
  return stat;
}

function projectChoice(choice: ChoiceV1, archetype: StarterArchetype): ChoiceV1 {
  return choice.kind === "check"
    ? { ...choice, stat: projectedStat(choice.stat, archetype) }
    : { ...choice };
}

function projectContent(archetype: StarterArchetype): DungeonContentV1 {
  const cloned = structuredClone(content);
  const projected = archetype === "baseline" ? content : {
    ...cloned,
    stages: cloned.stages.map((stage) => ({
      ...stage,
      ...(stage.choices
        ? { choices: stage.choices.map((choice) => projectChoice(choice, archetype)) }
        : {}),
      ...(stage.bossExchanges
        ? {
          bossExchanges: stage.bossExchanges.map((exchange) => ({
            ...exchange,
            choices: exchange.choices.map((choice) => projectChoice(choice, archetype)),
          })),
        }
        : {}),
    })),
  } as DungeonContentV1;
  const validation = validateDungeonContentV1(projected);
  if (!validation.ok) {
    throw new Error(`invalid_starter_archetype:${archetype}:${validation.errors.join("|")}`);
  }
  return projected;
}
```

Add `archetype` to `StarterSimulationReport`, pass projected content into `choicesFor` and
`resolveAndHash`, and wrap the existing matrix loops in `for (const archetype of archetypes)`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same focused test. Expected: both tests PASS and the deterministic matrix has 72 rows.

- [x] **Step 5: Commit Task 1**

```text
git add scripts/simulate-starter-builds.ts tests/unit/simulate_starter_builds_test.ts
git commit -m "test: simulate three starter dungeon archetypes"
```

---

### Task 2: Fail closed on incomplete matrices and pairwise dominance

**Files:**

- Modify: `tests/unit/simulate_starter_builds_test.ts`
- Modify: `scripts/simulate-starter-builds.ts:196-261`

**Interfaces:**

- Consumes: complete `readonly StarterSimulationReport[]`.
- Produces:
  `RingDominancePair`, `validateStarterBalanceMatrix`, `pairwiseDominancePairs`, and
  `assertNoPairwiseRingDominance`.

- [x] **Step 1: Write RED tests for pairwise detection and fail-closed validation**

Add a test helper that clones a complete real matrix and makes weapon strictly better than fire in
every shared context, then add these assertions:

```ts
Deno.test("pairwise gate reports the exact dominant and dominated ring", async () => {
  const reports = (await simulateStarterBuildMatrix()).map((report) =>
    report.ring === "weapon"
      ? {
        ...report,
        lastCompletedStage: 10,
        terminal: "victory" as const,
        remainingHp: 99,
        xp: 999,
        successfulChecks: { physical: 99, magical: 99, agility: 99, vitality: 99 },
      }
      : report.ring === "fire"
      ? {
        ...report,
        lastCompletedStage: 1,
        terminal: "defeated" as const,
        remainingHp: 0,
        xp: 0,
        successfulChecks: { physical: 0, magical: 0, agility: 0, vitality: 0 },
      }
      : report
  );
  assertEquals(
    pairwiseDominancePairs(reports).some((pair) =>
      pair.dominant === "weapon" && pair.dominated === "fire"
    ),
    true,
  );
  assertThrows(
    () => assertNoPairwiseRingDominance(reports),
    Error,
    "pairwise_starter_ring_dominance",
  );
});

Deno.test("pairwise gate rejects missing, duplicate, or active matrix rows", async () => {
  const reports = await simulateStarterBuildMatrix();
  assertThrows(() => pairwiseDominancePairs(reports.slice(1)), Error,
    "incomplete_starter_balance_matrix");
  assertThrows(() => pairwiseDominancePairs([...reports, reports[0]!]), Error,
    "incomplete_starter_balance_matrix");
  assertThrows(() => pairwiseDominancePairs([
    { ...reports[0]!, terminal: null }, ...reports.slice(1),
  ]), Error, "incomplete_starter_balance_matrix");
});
```

- [x] **Step 2: Run the focused test and verify RED**

Expected: type/check failure because the pairwise API does not exist.

- [x] **Step 3: Implement exact matrix validation**

Build `reportKeyFrom(archetype, partyMode, policy, ring)` plus `reportKey(report)`, then build the
expected 72 keys from the four known dimensions, reject non-terminal reports and compare the actual
key set without allowing duplicates:

```ts
export function validateStarterBalanceMatrix(
  reports: readonly StarterSimulationReport[],
): void {
  const expected = new Set<string>();
  for (const archetype of archetypes) for (const partyMode of partyModes) {
    for (const policy of policies) for (const ring of rings) {
      expected.add(`${archetype}:${partyMode}:${policy}:${ring}`);
    }
  }
  const actual = reports.map(reportKey);
  if (
    reports.length !== expected.size || new Set(actual).size !== expected.size ||
    reports.some((report) => report.terminal === null) ||
    actual.some((key) => !expected.has(key))
  ) throw new Error("incomplete_starter_balance_matrix");
}
```

- [x] **Step 4: Implement pairwise comparison across 18 shared contexts**

```ts
export interface RingDominancePair {
  readonly dominant: StarterRing;
  readonly dominated: StarterRing;
}

export function pairwiseDominancePairs(
  reports: readonly StarterSimulationReport[],
): readonly RingDominancePair[] {
  validateStarterBalanceMatrix(reports);
  const byKey = new Map(reports.map((report) => [reportKey(report), report]));
  const pairs: RingDominancePair[] = [];
  for (const dominant of rings) for (const dominated of rings) {
    if (dominant === dominated) continue;
    let anyStrict = false;
    let allNoWorse = true;
    for (const archetype of archetypes) for (const partyMode of partyModes) {
      for (const policy of policies) {
        const comparison = dominates(
          byKey.get(reportKeyFrom(archetype, partyMode, policy, dominant))!,
          byKey.get(reportKeyFrom(archetype, partyMode, policy, dominated))!,
        );
        allNoWorse &&= comparison.noWorse;
        anyStrict ||= comparison.strictlyBetter;
      }
    }
    if (allNoWorse && anyStrict) pairs.push({ dominant, dominated });
  }
  return pairs;
}
```

`assertNoPairwiseRingDominance` throws
`pairwise_starter_ring_dominance:<dominant>><dominated>` when pairs are present.

Implement the comparison through one internal `dominancePairsForArchetypes` helper so the baseline
diagnostic can reuse exactly the same two-ring comparator with a different validated key domain.

- [x] **Step 5: Run the focused test and verify GREEN**

Expected: all matrix, detection and invalid-shape tests PASS.

- [x] **Step 6: Commit Task 2**

```text
git add scripts/simulate-starter-builds.ts tests/unit/simulate_starter_builds_test.ts
git commit -m "test: reject pairwise starter ring dominance"
```

---

### Task 3: Expose canonical diagnostics and checkpoint the stricter gate

**Files:**

- Modify: `scripts/simulate-starter-builds.ts:257-261`
- Modify: `tests/unit/simulate_starter_builds_test.ts`
- Modify: `docs/superpowers/plans/2026-07-15-phase-04a-onboarding-starter-build.md`
- Modify: `docs/checkpoints/2026-07-15-phase-04a-gate-4-3.md`
- Modify: `PROJECT_STATE.md`
- Modify: `TASKS.md`
- Modify: `DECISIONS.md`

**Interfaces:**

- Consumes: validated 72-cell reports and pairwise API.
- Produces: `baselineRingDominancePairs(reports)`, canonical CLI object
  `{ reports, dominancePairs, baselineDominancePairs }`, and durable project-state evidence without
  changing the runtime hold.

- [x] **Step 1: Add a RED test for actual diagnostics**

Assert that the full matrix has no pairwise dominance, while the baseline diagnostic remains
explicitly computable through `baselineRingDominancePairs`. The helper filters `baseline`, validates
exactly 24 unique terminal baseline keys, then uses the same two-ring comparator as the full gate.

- [x] **Step 2: Run the focused test and verify RED**

Expected: failure because baseline diagnostics and the stricter assertion are not wired.

- [x] **Step 3: Implement the canonical result object**

```ts
const reports = await simulateStarterBuildMatrix();
const dominancePairs = pairwiseDominancePairs(reports);
assertNoPairwiseRingDominance(reports);
const baselineDominancePairs = baselineRingDominancePairs(reports);
console.log(canonicalJson({ reports, dominancePairs, baselineDominancePairs }));
```

Keep the baseline pairs diagnostic only in Gate 4.3; document them as a Phase 4T owner-smoke
blocker and never suppress them from output.

- [x] **Step 4: Run focused and complete source verification**

Run:

```text
npm run deno -- test tests/unit/simulate_starter_builds_test.ts
npm run simulate:starter
npm run verify
git diff --check
```

Expected: focused tests, simulation, 165+new unit tests and 3 property tests PASS; no format/lint/check
findings. If the actual full matrix reports dominance, stop and record the exact pairs instead of
changing production numbers or weakening the gate.

- [x] **Step 5: Update the plan, checkpoint and memory**

Record the owner decision, council verdict, 72-cell result, baseline diagnostic, commands, runtime
hold and exact next safe step. Do not mark Gate 4.2, Gate 4.3 or Phase 4A approved.

- [x] **Step 6: Commit Task 3**

```text
git add scripts/simulate-starter-builds.ts tests/unit/simulate_starter_builds_test.ts \
  docs/superpowers/plans/2026-07-15-phase-04a-onboarding-starter-build.md \
  docs/checkpoints/2026-07-15-phase-04a-gate-4-3.md PROJECT_STATE.md TASKS.md DECISIONS.md
git commit -m "test: enforce multi-archetype ring balance"
```

## Completion Boundary

This delta is source-complete: the 72-cell full matrix has zero dominance pairs, while the baseline
diagnostic records `weapon > fire`, `defense > fire` and `healing > fire`. `npm run verify` passes
with 168 unit and 3 property tests. Phase 4A remains under the existing Docker/database verification
hold until `npm run verify:phase4a` passes twice from clean resets; the non-empty baseline diagnostic
separately blocks Phase 4T owner-smoke until an owner-approved gameplay-balance amendment.
