# Phase 1 Deterministic Domain Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** build a pure, versioned TypeScript kernel that validates and replays one 10-stage fallback dungeon deterministically from stage 1 through the two-exchange boss, without DB, Telegram, network, or runtime RNG.

**Architecture:** Immutable content and run snapshots enter a resolver selected by `resolver_version`; pure party/combat helpers produce an explainable resolution, then canonical JSON and SHA-256 seal the result. Content validation has two layers: a reviewable JSON Schema artifact for shape and code lints for cross-stage quotas. All prototype balance numbers live in one versioned config and are exercised by replay, property, golden, cycle-boundary, and simulation tests.

**Tech Stack:** TypeScript, Deno 2.9.2, Deno test, `jsr:@std/assert@1.0.19`, Web Crypto SHA-256, JSON Schema draft 2020-12, npm wrapper scripts.

## Global Constraints

- Work only in `.worktrees/phase-01-domain-kernel` on branch `phase-01-domain-kernel`.
- Do not edit locked `CLAUDE.md`, approved game specs, lore, research, migrations, remote Supabase, or Telegram integrations.
- Runtime resolution imports no RNG and makes no network calls; all inputs are immutable snapshots plus versioned content/config.
- Content has exactly 10 stages, stages 1–2 contain no unconditional trap, at most 3 pure-combat stages, at least 1 research and 1 social stage, no adjacent equal encounter type, at most 2 important choices, and at most 1 unconditional trap.
- Every ordinary stage has 2–4 options including a neutral route; stage 5 is a one-choice mini-boss; stage 10 has exactly 2 exchanges and exchange 1 cannot return victory.
- Damage order is owner damage → owner vamp → surviving enemy counter/attrition → post-exchange heal only if group HP remains above 0.
- Vampirism uses actual non-overkill owner damage and is capped at 8% group max HP per stage and 25% per run; healing never exceeds max HP and never resurrects.
- Boss player damage is applied before counterattack; boss HP 0 suppresses counterattack and prevents double-zero ambiguity.
- Prototype daily XP cap is 150 and approximately 60% (90 XP) is allocated through stage 5; persistence and XP spending are outside this phase.
- Party formulas are exact: HP/physical/magical add; agility is `max + floor(0.25 × min)`; defense is `max + floor(0.50 × min)`. Vitality checks remain self-owned because the approved daily companion snapshot has max HP and defense but no partner vitality field.
- Cycle opens at 09:00 `Europe/Kyiv`, lasts 24 hours, and a run begun before reset has a 2-hour grace window.
- DB, Telegram, items, rings as progression systems, generator, reminders, and production deployment are outside this phase.

---

### Task 1: Reproducible toolchain and versioned contracts

**Files:**
- Create: `.gitattributes`
- Create: `supabase/functions/_shared/contracts/content.ts`
- Create: `supabase/functions/_shared/contracts/domain.ts`
- Modify: `deno.json`
- Test: `tests/unit/contracts_test.ts`

**Interfaces:**
- Produces: `DungeonContentV1`, `StageV1`, `ChoiceV1`, `ResolverConfigV1`, `PartySnapshot`, `RunStateV1`, `ChoiceCommandV1`, `ResolutionV1`, and exact string-union enums used by every later task.

- [x] **Step 1: Keep the failing worktree baseline as evidence**

Run: `npm run verify`

Expected historical RED: `deno fmt --check` reports the checkout files differ only by line endings under system `core.autocrlf=true`.

- [x] **Step 2: Enforce LF at repository level and verify the baseline**

Create `.gitattributes`:

```gitattributes
* text=auto eol=lf
```

Run: `npx deno fmt deno.json package.json .github/workflows/ci.yml supabase/functions tests/unit && npm run verify`

Expected: 4 existing tests pass, format/lint/check exit 0, and `git diff` contains no content changes to the ten normalized files.

- [x] **Step 3: Write contract tests before the contracts**

Create `tests/unit/contracts_test.ts` with compile-time fixtures and runtime assertions:

```ts
import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { ChoiceCommandV1, PartySnapshot, RunStateV1 } from "../../supabase/functions/_shared/contracts/domain.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";

Deno.test("v1 contracts represent an immutable replay command", () => {
  const command: ChoiceCommandV1 = { resolverVersion: "v1", stage: 1, choiceId: "s1-neutral" };
  const state: RunStateV1 = { stage: 1, exchange: null, hp: 40, bossHp: null, xp: 0, vampHealedRun: 0, terminal: null };
  const party: PartySnapshot = { mode: "solo", self: { maxHp: 40, physical: 5, magical: 5, agility: 5, vitality: 5, defense: 5, vampRateBps: 0, postHeal: 0 }, companion: null };
  const content = { schemaVersion: "dungeon-v1", resolverVersion: "v1", id: "case-001-day-01", title: "Побічна тривога", stages: [] } as unknown as DungeonContentV1;
  assertEquals([command.resolverVersion, state.stage, party.mode, content.schemaVersion], ["v1", 1, "solo", "dungeon-v1"]);
});
```

Run: `npx deno test tests/unit/contracts_test.ts`

Expected: FAIL because both contract modules are missing.

- [x] **Step 4: Implement focused content and domain contracts**

Use these exact unions and field names:

```ts
export type Stat = "physical" | "magical" | "agility" | "vitality";
export type EncounterType = "exploration" | "research" | "social" | "hazard" | "pursuit" | "combat";
export type ChoiceKind = "check" | "neutral" | "trap";
export type TacticalModifier = "counter" | "standard" | "against_telegraph";
export type Outcome = "success" | "neutral" | "failure";
export type TerminalResult = "victory" | "contained" | "defeated";
```

`ChoiceV1` contains `id`, `label`, `kind`, `clueId`, `rationale`, optional `stat`, `tier`, `tacticalModifier`, and `copy: { success; neutral; failure }`. `StageV1` contains `number`, `role`, `encounterType`, `important`, `clues`, and either ordinary `choices` or stage-10 `bossExchanges`. Numeric thresholds, damage, XP, rarity, and chance fields are forbidden in content types.

`ResolverConfigV1` contains immutable `stageThresholds`, `tierDelta`, `tacticalBandDelta`, `successDamage`, `neutralDamage`, `failureDamage`, `stageXp`, `neutralXpPercent`, `bossMaxHp`, `bossDamage`, `bossOwnerDamage`, `defenseScale`, `vampStageCapBps: 800`, `vampRunCapBps: 2500`, and `dailyXpCap: 150`.

Run: `npx deno test tests/unit/contracts_test.ts && npx deno check supabase/functions/_shared/contracts/content.ts supabase/functions/_shared/contracts/domain.ts`

Expected: PASS.

- [x] **Step 5: Expand verification scopes and commit**

Set Deno tasks to format/lint `scripts`, `supabase/functions`, and all `tests`; type-check the contracts plus later registry entrypoint; run unit and property directories. Until later files exist, add only paths created in this task.

Run: `npm run verify`

Expected: all existing and contract tests pass.

Commit: `chore: make Phase 1 worktree reproducible`

---

### Task 2: Dungeon schema, semantic lints, and reviewed fallback fixture ✅

**Files:**
- Create: `content/schemas/dungeon-v1.schema.json`
- Create: `content/fallback/case-001/day-01.json`
- Create: `supabase/functions/_shared/domain/content-validator.ts`
- Test: `tests/unit/content_validator_test.ts`

**Interfaces:**
- Consumes: `DungeonContentV1`, `StageV1`, `ChoiceV1`.
- Produces: `validateDungeonContentV1(value: unknown): ValidationResult` and `assertDungeonContentV1(value: unknown): asserts value is DungeonContentV1`, where `ValidationResult = { ok: true } | { ok: false; errors: string[] }`.

- [x] **Step 1: Write table-driven rejection tests**

The test loads the valid fallback, clones it, applies one mutation per case, and asserts an exact error fragment:

```ts
const cases = [
  ["nine stages", (x: any) => x.stages.pop(), "stages must contain exactly 10 entries"],
  ["missing neutral", (x: any) => x.stages[2].choices = x.stages[2].choices.filter((c: any) => c.kind !== "neutral"), "stage 3 must contain a neutral choice"],
  ["early trap", (x: any) => x.stages[0].choices[0].kind = "trap", "trap is forbidden on stages 1-2"],
  ["boss exchange count", (x: any) => x.stages[9].bossExchanges.pop(), "stage 10 must contain exactly 2 boss exchanges"],
  ["adjacent encounter", (x: any) => x.stages[1].encounterType = x.stages[0].encounterType, "adjacent stages must differ"],
];
```

Also reject 4 combat stages, no research stage, no social stage, 3 important choices, 2 traps, duplicate IDs, missing clue references, text over 700 characters, fewer than 2 or more than 4 options, ordinary boss fields on stages 1–9, and choices on stage 10 outside exchanges.

Run: `npx deno test tests/unit/content_validator_test.ts`

Expected: FAIL because validator and fixture are missing.

- [x] **Step 2: Add the JSON Schema shape contract**

Use draft 2020-12 with `additionalProperties: false`, required root fields, `minItems/maxItems: 10`, stage number bounds 1–10, 2–4 choices, exact enums, 700-character scene text, and conditional stage-10 `bossExchanges` with exactly two entries. The schema handles local shape; code lints handle quotas, uniqueness, adjacency, clue references, and stage-position rules.

Run: `npx deno eval 'JSON.parse(await Deno.readTextFile("content/schemas/dungeon-v1.schema.json")); console.log("schema-json-ok")'`

Expected: `schema-json-ok`.

- [x] **Step 3: Create the complete fallback blueprint**

Use this exact stage matrix; every non-boss stage has two check routes plus neutral, stage 4 adds the only trap as a fourth option, and both boss exchanges have two checks plus neutral:

| Stage | Role | Encounter | Important | Check stats | Trap |
|---:|---|---|---|---|---|
| 1 | entry | exploration | no | agility / vitality | no |
| 2 | clue | research | no | magical / agility | no |
| 3 | application | combat | no | physical / magical | no |
| 4 | resistance | hazard | yes | agility / vitality | yes |
| 5 | miniboss | combat | no | magical counter / physical standard | no |
| 6 | counterplay | social | no | vitality / magical | no |
| 7 | escalation | pursuit | no | agility / physical | no |
| 8 | dilemma | social | yes | magical / vitality | no |
| 9 | synthesis | research | no | agility / magical | no |
| 10 | boss | combat | no | exchange 1 physical counter / magical standard; exchange 2 magical counter / agility standard | no |

Each check references a visible clue ID, carries a one-sentence rationale, and has Ukrainian success/failure copy; each neutral route has fixed neutral copy. Keep every scene at or below 700 characters and do not put numeric mechanics in JSON.

- [x] **Step 4: Implement schema-equivalent guards and cross-stage lints**

Build errors in stable stage/choice traversal order. Validate shape first, then stage numbering/role, option counts, neutral presence, clue reference, duplicate IDs, early trap, total trap/important/combat quotas, research/social coverage, adjacency, and boss structure. Return every discovered error rather than throwing on the first; `assertDungeonContentV1` throws `Invalid dungeon-v1 content: ${errors.join("; ")}`.

Run: `npx deno test tests/unit/content_validator_test.ts`

Expected: all valid/rejection cases pass.

- [x] **Step 5: Verify and commit**

Run: `npm run verify`

Expected: schema parses, fallback validates, and all tests pass.

Commit: `feat: validate v1 dungeon content`

---

### Task 3: Transparent solo, teacher, and partner aggregation ✅

**Files:**
- Create: `supabase/functions/_shared/domain/resolvers/v1/party.ts`
- Test: `tests/unit/party_test.ts`
- Test: `tests/property/party_invariants_test.ts`

**Interfaces:**
- Consumes: `PartySnapshot`, `CombatantSnapshot`.
- Produces: `aggregateParty(snapshot: PartySnapshot): AggregatedParty` with exact `total` and `breakdown` fields.

- [x] **Step 1: Write examples and invariants**

Test solo identity, teacher aggregation, partner aggregation, swapped-member symmetry, integer flooring, and no mutation:

```ts
const self = { maxHp: 40, physical: 12, magical: 8, agility: 12, vitality: 9, defense: 15, vampRateBps: 0, postHeal: 0 };
const friend = { maxHp: 55, physical: 7, magical: 20, agility: 8, vitality: 11, defense: 8, vampRateBps: 0, postHeal: 0 };
assertEquals(aggregateParty({ mode: "partner", self, companion: friend }).total, {
  maxHp: 95, physical: 19, magical: 28, agility: 14, vitality: 9, defense: 19,
});
```

Property loop: for deterministic integers `a,b` in 0…100, assert additive HP/physical/magical totals, `agility = max + floor(min/4)`, `defense = max + floor(min/2)`, symmetry for companion-owned fields, self-only vitality, and solo equality.

Run: `npx deno test tests/unit/party_test.ts tests/property/party_invariants_test.ts`

Expected: FAIL because `aggregateParty` is missing.

- [x] **Step 2: Implement pure aggregation and breakdown**

Return `breakdown.self`, optional `breakdown.companion`, and explicit assist values for agility/defense. Only the self snapshot supplies `vampRateBps` and `postHeal`; companion support is default-deny in Phase 1.

Run: `npx deno test tests/unit/party_test.ts tests/property/party_invariants_test.ts`

Expected: PASS.

- [x] **Step 3: Verify and commit**

Run: `npm run verify`

Commit: `feat: aggregate immutable party snapshots`

---

### Task 4: HP, defense, vampirism, healing, and boss exchange order ✅

**Files:**
- Create: `supabase/functions/_shared/domain/resolvers/v1/combat.ts`
- Test: `tests/unit/combat_test.ts`
- Test: `tests/property/combat_invariants_test.ts`

**Interfaces:**
- Produces: `mitigateDamage(raw, defense, scale)`, `applyHeal(hp, maxHp, amount)`, and `resolveCombatExchange(input): CombatExchangeResult`.

- [x] **Step 1: Write failing combat-order examples**

Cover no overheal, heal-at-zero, non-overkill owner damage, stage/run vamp caps, vamp before counter, boss death suppressing counter, counter reducing HP to zero suppressing post-heal, and damage mitigation:

```ts
assertEquals(applyHeal(0, 100, 30), 0);
assertEquals(applyHeal(90, 100, 30), 100);
const result = resolveCombatExchange({ hp: 20, maxHp: 100, bossHp: 5, ownerDamage: 20, incomingDamage: 99, defense: 0, defenseScale: 100, vampRateBps: 5000, vampStageCapBps: 800, vampRunCapBps: 2500, vampHealedStage: 0, vampHealedRun: 0, postHeal: 10 });
assertEquals({ bossHp: result.bossHp, actualOwnerDamage: result.actualOwnerDamage, incoming: result.incomingDamage, hp: result.hp }, { bossHp: 0, actualOwnerDamage: 5, incoming: 0, hp: 32 });
```

Run: `npx deno test tests/unit/combat_test.ts`

Expected: FAIL because combat helpers are missing.

- [x] **Step 2: Implement the exact pure algorithm**

```ts
const actualOwnerDamage = Math.min(input.bossHp, Math.max(0, input.ownerDamage));
const bossHp = input.bossHp - actualOwnerDamage;
const rawVamp = Math.floor(actualOwnerDamage * input.vampRateBps / 10_000);
const stageRoom = Math.floor(input.maxHp * input.vampStageCapBps / 10_000) - input.vampHealedStage;
const runRoom = Math.floor(input.maxHp * input.vampRunCapBps / 10_000) - input.vampHealedRun;
const vamp = Math.max(0, Math.min(rawVamp, stageRoom, runRoom));
let hp = applyHeal(input.hp, input.maxHp, vamp);
const incoming = bossHp === 0 ? 0 : mitigateDamage(input.incomingDamage, input.defense, input.defenseScale);
hp = Math.max(0, hp - incoming);
const postHeal = hp === 0 ? 0 : applyHeal(hp, input.maxHp, input.postHeal) - hp;
hp += postHeal;
```

`mitigateDamage` returns 0 for non-positive raw damage; otherwise `max(1, floor(raw × scale / (scale + max(0, defense))))`.

- [x] **Step 3: Add deterministic property coverage**

Iterate a fixed Cartesian sample of HP, max HP, damage, defense, boss HP, vamp rate, and healing values. Assert all HP values stay in `[0,maxHp]`, boss HP is non-negative, actual owner damage never exceeds pre-exchange boss HP, healing at zero is zero, vamp never exceeds actual owner damage-derived heal or either cap, boss death means incoming damage zero, and post-heal is zero after lethal incoming damage.

Run: `npx deno test tests/unit/combat_test.ts tests/property/combat_invariants_test.ts`

Expected: PASS.

- [x] **Step 4: Verify and commit**

Run: `npm run verify`

Commit: `feat: resolve deterministic combat exchanges`

---

### Task 5: V1 stage, mini-boss, and two-exchange boss resolver ✅

**Files:**
- Create: `supabase/functions/_shared/domain/resolvers/v1/config.ts`
- Create: `supabase/functions/_shared/domain/resolvers/v1/resolver.ts`
- Test: `tests/unit/resolver_test.ts`
- Test: `tests/fixtures/replays/v1/success.json`
- Test: `tests/fixtures/replays/v1/neutral.json`
- Test: `tests/fixtures/replays/v1/failure.json`
- Test: `tests/fixtures/replays/v1/trap.json`
- Test: `tests/fixtures/replays/v1/defeated.json`
- Test: `tests/fixtures/replays/v1/victory.json`
- Test: `tests/fixtures/replays/v1/contained.json`
- Test: `tests/fixtures/replays/v1/double-zero-prevented.json`

**Interfaces:**
- Consumes: validated `DungeonContentV1`, `PartySnapshot`, `RunStateV1`, `ChoiceCommandV1`, combat and party helpers.
- Produces: `CONFIG_V1`, `resolveChoiceV1(input): ResolutionV1`, and `advanceStateV1(state, resolution): RunStateV1`.

- [x] **Step 1: Write fixture-driven failing tests**

Each replay fixture contains `{ contentPath, party, state, command, expected }`. Assert outcome, threshold/power breakdown, HP delta, XP, next stage/exchange, and terminal result. Explicitly assert:

```ts
assertEquals(exchangeOne.resolution.terminal, null);
assertEquals(exchangeOne.resolution.nextExchange, 2);
assertEquals(lethalExchangeOne.resolution.terminal, "defeated");
assertEquals(lethalExchangeOne.resolution.nextExchange, null);
assertEquals(doubleZero.resolution.terminal, "victory");
assertEquals(doubleZero.resolution.incomingDamage, 0);
```

Run: `npx deno test tests/unit/resolver_test.ts`

Expected: FAIL because the V1 resolver is missing.

- [x] **Step 2: Add one immutable prototype config**

Use `Object.freeze` and these exact budgets so simulation changes are reviewable in one file:

```ts
export const CONFIG_V1 = {
  stageThresholds: [5, 7, 10, 14, 19, 25, 32, 40, 49, 60],
  tierDelta: { easy: -2, standard: 0, hard: 5 },
  tacticalBandDelta: { counter: -1, standard: 0, against_telegraph: 1 },
  successDamage: [0, 0, 1, 2, 3, 3, 4, 5, 5, 0],
  neutralDamage: [2, 2, 3, 4, 6, 6, 7, 8, 8, 0],
  failureDamage: [5, 6, 8, 10, 13, 14, 16, 18, 20, 0],
  stageXp: [10, 15, 18, 20, 27, 10, 12, 13, 10, 15],
  neutralXpPercent: 20,
  bossMaxHp: 90,
  bossDamage: [24, 34],
  bossOwnerDamage: [32, 58],
  bossNeutralDamagePercent: 25,
  bossCounterIncomingPercent: 50,
  bossFailureIncomingPercent: 150,
  defenseScale: 100,
  vampStageCapBps: 800,
  vampRunCapBps: 2500,
  dailyXpCap: 150,
} as const;
```

Assert `sum(stageXp) === 150` and `sum(stageXp.slice(0,5)) === 90` in `resolver_test.ts`.

- [x] **Step 3: Implement ordinary resolution and explainability**

Neutral bypasses the check, grants `floor(stageXp × 20 / 100)`, and applies neutral damage. Trap always returns failure. Check computes `threshold = stageThreshold + tierDelta + tacticalBandDelta` and reads the selected aggregate stat; enough power gives success, otherwise failure. Every result includes clue ID/text, rationale, stat, self/companion/total breakdown, threshold, HP before/damage/healing/after, XP before/delta/after, and next state.

Clamp XP output to `dailyXpCap - state.xp`; do not persist it. Before stage 10, terminal is only `defeated` when HP reaches 0.

- [x] **Step 4: Implement mini-boss and boss state transitions**

Stage 5 uses the same one-choice resolver with counter threshold band `-1`, standard `0`, and neutral attrition. Stage 10 exchange 1 is valid only from `state.exchange === null` and `state.bossHp === null`; it initializes the configured full `bossMaxHp`. The configured exchange-1 owner damage is lower than full boss HP, so a valid replay cannot win there. Reject a forged exchange-1 state carrying partial boss HP rather than silently clamping it. Return `nextExchange: 2` only when group HP remains positive. Exchange 2 returns victory when boss HP reaches 0, defeated when group HP reaches 0, otherwise contained. Combat helper ordering suppresses counterattack after boss death.

Run: `npx deno test tests/unit/resolver_test.ts`

Expected: all eight replay semantics pass.

- [x] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: resolve v1 dungeon stages and boss`

---

### Task 6: Resolver registry, canonical result bytes, hash, and golden replay ✅

**Files:**
- Create: `supabase/functions/_shared/domain/canonical-json.ts`
- Create: `supabase/functions/_shared/domain/resolver-registry.ts`
- Create: `tests/property/determinism_test.ts`
- Create: `tests/unit/resolver_golden_replay_test.ts`
- Create: `tests/fixtures/replays/v1/golden-full-run.json`
- Create: `tests/fixtures/replays/v1/golden-full-run.result.json`

**Interfaces:**
- Produces: `canonicalJson(value): string`, `sha256Hex(text): Promise<string>`, `resolveAndHash(input): Promise<{ resolution; canonical; hash }>` and `getResolver(version: "v1"): Resolver`.

- [x] **Step 1: Write canonicalization and unknown-version failures**

Assert recursively sorted object keys, preserved array order, rejection of `undefined`, non-finite numbers, and unknown resolver versions:

```ts
assertEquals(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
assertThrows(() => getResolver("v2" as "v1"), Error, "Unsupported resolver version: v2");
```

Run: `npx deno test tests/unit/resolver_golden_replay_test.ts`

Expected: FAIL because registry/canonical helpers are missing.

- [x] **Step 2: Implement canonical JSON and SHA-256**

Canonicalize only null, boolean, finite number, string, arrays, and plain objects. Sort object keys lexicographically, omit no values, and throw with the JSON path for unsupported values. Hash UTF-8 bytes with `crypto.subtle.digest("SHA-256", bytes)` and lower-case hex.

- [x] **Step 3: Implement closed registry dispatch**

```ts
const resolvers = Object.freeze({ v1: { resolveChoice: resolveChoiceV1 } });
export function getResolver(version: "v1") {
  const resolver = resolvers[version];
  if (!resolver) throw new Error(`Unsupported resolver version: ${version}`);
  return resolver;
}
```

`resolveAndHash` dispatches by the command/content version, resolves once, canonicalizes the resolution, and hashes those exact bytes.

- [x] **Step 4: Add 1000-repeat and golden tests**

Resolve the same fixture 1000 times and require identical canonical bytes/hash. Replay the full fallback path through boss summary, compare the complete result JSON and pinned hash to `golden-full-run.result.json`, and confirm the expected hash has 64 lower-case hexadecimal characters.

Run: `npx deno test tests/property/determinism_test.ts tests/unit/resolver_golden_replay_test.ts`

Expected: PASS; changing a V1 result changes the golden bytes/hash and fails the test.

- [x] **Step 5: Verify and commit**

Run: `npm run verify`

Commit: `feat: seal deterministic resolver replays`

---

### Task 7: Europe/Kyiv cycle and grace boundaries

**Files:**
- Create: `supabase/functions/_shared/domain/cycle.ts`
- Test: `tests/unit/cycle_test.ts`

**Interfaces:**
- Produces: `getCycleWindow(now: Date): { cycleId; opensAt; closesAt; graceEndsAt }` and `zonedLocalToUtc(parts, "Europe/Kyiv"): Date`.

- [ ] **Step 1: Write failing normal-day and DST boundary tests**

Use fixed UTC instants around Kyiv 09:00 in winter/summer and both DST transition weekends. Assert the local cycle date, exact UTC open/close timestamps, consecutive local 09:00 boundaries whose UTC duration is 23/25 hours across DST, and `graceEndsAt = closesAt + 2 hours`.

```ts
assertEquals(getCycleWindow(new Date("2026-01-15T07:30:00Z")).cycleId, "2026-01-15");
assertEquals(getCycleWindow(new Date("2026-07-15T06:30:00Z")).cycleId, "2026-07-15");
assertEquals(getCycleWindow(new Date("2026-07-15T05:59:59Z")).cycleId, "2026-07-14");
```

Run: `npx deno test tests/unit/cycle_test.ts`

Expected: FAIL because cycle helpers are missing.

- [ ] **Step 2: Implement timezone conversion without fixed offsets**

Use `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" })`. Convert a target local 09:00 to UTC by starting from `Date.UTC(parts...)`, formatting in Kyiv, applying the observed local-vs-UTC delta, and verifying the formatted result equals the requested local parts; throw if convergence fails after three corrections.

Derive the local date containing `now`, choose today or previous day based on local time before 09:00, independently convert that date and next calendar date at 09:00, then add two absolute hours for grace.

- [ ] **Step 3: Verify and commit**

Run: `npm run verify`

Expected: cycle tests pass on standard time and DST boundaries without assuming `+02:00` or `+03:00`.

Commit: `feat: calculate Kyiv dungeon cycles`

---

### Task 8: Balance simulation, final verification, and phase checkpoint

**Files:**
- Create: `scripts/simulate-balance.ts`
- Create: `docs/checkpoints/2026-07-12-phase-01.md`
- Modify: `PROJECT_STATE.md`
- Modify: `TASKS.md`
- Modify: `deno.json`

**Interfaces:**
- Consumes: fallback content, validator, registry, `CONFIG_V1`, and party fixtures.
- Produces: deterministic CLI report with build name, terminal stage/result, remaining HP, earned XP, and replay hash.

- [ ] **Step 1: Write simulation expectations as tests**

Add `tests/unit/simulation_test.ts` around exported `simulateBuild`:

```ts
const early = await simulateBuild(EARLY_TEACHER_BUILD, "recommended-checks");
assertEquals(early.lastCompletedStage >= 4 && early.lastCompletedStage <= 6, true);
const developed = await simulateBuild(DEVELOPED_SOLO_BUILD, "recommended-checks");
assertEquals(developed.terminal, "victory");
assertEquals(developed.lastCompletedStage, 10);
```

Also assert repeated simulation reports are identical and every report XP is at most 150.

Run: `npx deno test tests/unit/simulation_test.ts`

Expected: FAIL because the simulator is missing.

- [ ] **Step 2: Implement CLI simulation through the public registry**

Define an early tutorial snapshot with all self stats 5 plus a modest teacher contribution, and a developed solo snapshot whose specialization can legally meet stage-10 counter thresholds. Select the first compatible counter check, otherwise standard check, otherwise neutral. Advance state only through `resolveAndHash`; do not duplicate resolver formulas in the simulator.

When invoked directly, print canonical JSON for both builds. Export fixtures and `simulateBuild` for tests.

Run: `npx deno run --allow-read scripts/simulate-balance.ts`

Expected: early build terminates near the stage-5 boundary; developed solo reaches stage 10 with victory; both reports contain stable 64-character hashes.

- [ ] **Step 3: Run the full phase gate**

Run:

```powershell
npm run verify
npx deno test tests/property/determinism_test.ts --filter "1000"
npx deno run --allow-read scripts/simulate-balance.ts
git diff --check
```

Expected: format/lint/type-check/tests pass; 1000-repeat determinism passes; simulation meets both reach targets; diff check is clean.

- [ ] **Step 4: Record the checkpoint and project memory**

`docs/checkpoints/2026-07-12-phase-01.md` records fresh commands, pass counts, golden hash, simulation outputs, scope exclusions, and any prototype-balance caveat. Mark P1-01…P1-05 complete and Phase 1 `approved` only after Step 3 evidence; otherwise keep the failing item `in_progress`. Set the next safe step to Phase 2 planning, not migrations or remote deployment.

- [ ] **Step 5: Final commit**

Run: `git status --short && git diff --check && npm run verify`

Expected: only intended Phase 1 files are present and verification passes.

Commit: `feat: add deterministic dungeon kernel`

---

## Self-Review Record

- Spec coverage: contracts/schema/quotas (Tasks 1–2), party snapshots (Task 3), HP/defense/heal/vamp order and caps (Task 4), stage outcomes/mini-boss/two-exchange boss/XP (Task 5), versioned replay/hash and no implicit entropy (Task 6), Kyiv cycle/grace (Task 7), early/developed balance evidence and project checkpoint (Task 8).
- Scope exclusions are explicit: no DB, Telegram, item/ring progression, generator, reminders, migrations, or remote mutation.
- Type consistency: `DungeonContentV1`, `PartySnapshot`, `RunStateV1`, `ChoiceCommandV1`, `ResolutionV1`, `CONFIG_V1`, `resolveChoiceV1`, `resolveAndHash`, and `simulateBuild` keep the same names across producers and consumers.
- Placeholder scan: all implementation steps name exact files, signatures, commands, expected outcomes, and prototype constants.
- Residual P01 findings remain tracked for later content/UX work; Phase 1 exposes explainability and contribution breakdowns but does not silently change the approved encounter quotas or add progression systems.
