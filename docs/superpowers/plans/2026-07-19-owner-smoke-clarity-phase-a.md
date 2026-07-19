# Owner Smoke Clarity Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Telegram tutorial explain its checks and XP honestly, hide inactive effects, and expose a complete read-only Hero projection before the next expedition.

**Architecture:** Keep resolver V1 and persistent progression untouched. Renderers consume the canonical resolution, selected authored choice metadata, and canonical build projection; they only improve presentation and navigation. Phase B callbacks are intentionally absent from this plan.

**Tech Stack:** Deno 2, TypeScript, Supabase Edge Functions, Telegram inline keyboards, `@std/assert` unit tests.

## Global Constraints

- Do not edit migrations 001–016, recovery migrations 001–002, resolver V1, locked balance config/golden vectors, or `content/fallback/case-001/day-01.json`.
- Do not change thresholds, reward probabilities, snapshots, persistence, Telegram webhook ownership, or production.
- Only acquired positive combat effects may appear in a resolution card.
- Renderers explain the canonical result but never recompute it.
- Teacher guidance teaches clue/action fit without normally naming the exact winning button.
- Character access in Phase A is read-only.

---

## File Structure

- `supabase/functions/_shared/render/stage-card.ts`: stage guidance and canonical resolution explanation.
- `supabase/functions/_shared/render/tutorial.ts`: first-training forecast and tutorial-home Hero entry.
- `supabase/functions/_shared/render/menu.ts`: tutorial menu navigation.
- `supabase/functions/_shared/render/hero.ts`: full three-slot/ring/loadout projection.
- `tests/unit/render_test.ts`: base resolved-card contract.
- `tests/unit/progression_render_test.ts`: tutorial and progression-card contracts.
- `TASKS.md`, `PROJECT_STATE.md`: phase checkpoint after verification.

### Task 1: Honest Resolution Effects and Check Explanation

**Files:**
- Modify: `supabase/functions/_shared/render/stage-card.ts`
- Test: `tests/unit/render_test.ts`
- Test: `tests/unit/progression_render_test.ts`

**Interfaces:**
- Consumes: `ResolutionV1`, `DungeonContentV1`, and selected `ChoiceV1` metadata.
- Produces: `approachExplanation(content, resolution): string | null` and unchanged public `renderResolvedCard(input): RenderedCard`.

- [ ] **Step 1: Write failing tests for zero-effect omission and visible check logic**

Add assertions equivalent to:

```ts
const noEffects = renderResolvedCard({
  resolution: {
    ...resolution,
    hp: { ...resolution.hp, vampHeal: 0, postHeal: 0 },
  },
  next: null,
  content: fallback,
});
assertNotMatch(noEffects.text, /Вампіризм|Відновлення/u);

assertStringIncludes(card.text, "Разом: 61");
assertStringIncludes(card.text, "Для успіху потрібно: 60");
assertStringIncludes(card.text, "Запас: +1");
assertStringIncludes(card.text, "Влучний підхід знизив вимогу");
```

Add a failure fixture and assert `Не вистачило: N`. Retain the existing positive-effect assertions so acquired vampirism and recovery remain visible.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
deno test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/render_test.ts tests/unit/progression_render_test.ts
```

Expected: FAIL because zero labels are still present and the new check copy does not exist.

- [ ] **Step 3: Add metadata-backed approach explanation**

Add a private selected-choice lookup shared by `outcomeCopy` and the explanation. Map only authored metadata:

```ts
function approachExplanation(content: DungeonContentV1, resolution: ResolutionV1): string | null {
  const choice = selectedChoice(content, resolution);
  if (!choice) return null;
  if (choice.kind === "neutral") {
    return "Обережний вибір пропустив перевірку, але має власну ціну в HP або XP.";
  }
  if (choice.kind === "trap") {
    return "Це була пастка: характеристика не могла виправити невдалий підхід.";
  }
  if (choice.tier === "easy" || choice.tacticalModifier === "counter") {
    return "Влучний підхід знизив вимогу перевірки.";
  }
  if (choice.tier === "hard" || choice.tacticalModifier === "against_telegraph") {
    return "Ризикований підхід підвищив вимогу перевірки.";
  }
  return "Застосовано стандартну вимогу перевірки.";
}
```

Do not calculate a delta from config in this function.

- [ ] **Step 4: Render requirement, margin, and only positive effects**

Change checked resolution output to the semantic equivalent of:

```ts
const margin = resolution.check.totalPower - resolution.check.threshold;
lines.push(
  "",
  `Перевірка — ${STAT_LABELS[resolution.check.stat]}`,
  `Ви: ${resolution.check.selfPower} · Напарник: ${resolution.check.companionPower}`,
  `Разом: ${resolution.check.totalPower}`,
  `Для успіху потрібно: ${resolution.check.threshold}`,
  margin >= 0 ? `Запас: +${margin}` : `Не вистачило: ${Math.abs(margin)}`,
);
```

Build effect rows conditionally:

```ts
if (resolution.hp.vampHeal > 0) lines.push(`Вампіризм: +${resolution.hp.vampHeal}`);
if (resolution.hp.postHeal > 0) lines.push(`Відновлення: +${resolution.hp.postHeal}`);
```

Append the metadata-backed explanation when content is available.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- supabase/functions/_shared/render/stage-card.ts tests/unit/render_test.ts tests/unit/progression_render_test.ts
git commit -m "feat: explain Telegram checks clearly"
```

### Task 2: Fixed Teacher Guidance and Explicit XP Remainder

**Files:**
- Modify: `supabase/functions/_shared/render/stage-card.ts`
- Modify: `supabase/functions/_shared/render/tutorial.ts`
- Test: `tests/unit/progression_render_test.ts`

**Interfaces:**
- Consumes: existing `FULL_GUIDANCE`, tutorial guidance mode, `TrainingChoiceOption.cost`, and `TrainingChoiceCardInput.freeXp`.
- Produces: deterministic mechanic-teaching copy and remaining-XP projections.

- [ ] **Step 1: Write failing teacher and XP assertions**

Add assertions equivalent to:

```ts
assertStringIncludes(stage.text, "влучний підхід знижує вимогу");
assertStringIncludes(card.text, "Після тренування залишиться: 43 XP");
assertStringIncludes(card.text, "Живучість: 5 → 6 · 20 XP · залишиться 43 XP");
```

Use a `freeXp: 63` fixture so the owner's observed `63 → 43` example is covered.

- [ ] **Step 2: Run the focused progression renderer test and confirm RED**

```powershell
deno test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/progression_render_test.ts
```

Expected: FAIL on the new guidance/remainder strings.

- [ ] **Step 3: Rewrite fixed guidance without revealing an answer ID**

Keep the encounter-specific clue advice, then append the invariant game rule. The full guidance must contain the equivalent of:

```ts
"Зіставте спостереження з дією: влучний підхід знижує вимогу перевірки, а ризикований — підвищує."
```

Light guidance must state the same rule more compactly. Do not include choice labels, IDs, thresholds, or “correct answer”.

- [ ] **Step 4: Add remaining XP to every training option**

For each option, render:

```ts
const remainingXp = input.freeXp - option.cost;
`${STAT_LABELS[option.stat]}: ${option.current} → ${option.next} · ${option.cost} XP · залишиться ${remainingXp} XP`
```

Keep the authoritative option list supplied by the server; do not create unaffordable client-side options.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- supabase/functions/_shared/render/stage-card.ts supabase/functions/_shared/render/tutorial.ts tests/unit/progression_render_test.ts
git commit -m "feat: teach choice logic and XP cost"
```

### Task 3: Tutorial Hero Entry and Complete Read-Only Loadout

**Files:**
- Modify: `supabase/functions/_shared/render/tutorial.ts`
- Modify: `supabase/functions/_shared/render/menu.ts`
- Modify: `supabase/functions/_shared/render/hero.ts`
- Test: `tests/unit/progression_render_test.ts`

**Interfaces:**
- Consumes: `CanonicalBuildView.loadoutSnapshot.items`, `.rings`, `.selfSnapshot.vampRateBps`, and `.postHeal`.
- Produces: unchanged `renderHeroCard(input): RenderedCard`, now with explicit three-slot and ring state.

- [ ] **Step 1: Write failing navigation and empty/full loadout tests**

Assert tutorial cards and menus include `nav:hero`. Add an empty build fixture and assertions equivalent to:

```ts
assertStringIncludes(emptyHero.text, "Основний предмет: порожньо");
assertStringIncludes(emptyHero.text, "Обладунок: порожньо");
assertStringIncludes(emptyHero.text, "Талісман: порожньо");
assertStringIncludes(emptyHero.text, "Магічні кільця: немає");
assertNotMatch(emptyHero.text, /Вампіризм|Відновлення/u);
```

For the populated fixture, assert item labels occupy the correct slots and the ring is listed.

- [ ] **Step 2: Run the focused renderer test and confirm RED**

```powershell
deno test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/progression_render_test.ts
```

Expected: FAIL because tutorial navigation lacks Hero and the card lacks explicit slots.

- [ ] **Step 3: Add Hero to both tutorial surfaces**

Use the existing static callback only:

```ts
staticButton("Герой", "nav:hero")
```

Place it on a separate concise row where necessary so no primary action becomes ambiguous.

- [ ] **Step 4: Render explicit slot and ring sections**

Use fixed slot order and labels:

```ts
const ITEM_SLOTS = [
  ["main", "Основний предмет"],
  ["armor", "Обладунок"],
  ["talisman", "Талісман"],
] as const;
```

For each slot, find the equipped item and render its label or `порожньо`. Render `Магічні кільця: немає` when no ring is equipped. Keep positive `postHeal` through the existing stat breakdown and add `Вампіризм: N%` only when `vampRateBps > 0`; do not print zero values.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: all tests pass and every callback remains ≤64 bytes.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- supabase/functions/_shared/render/tutorial.ts supabase/functions/_shared/render/menu.ts supabase/functions/_shared/render/hero.ts tests/unit/progression_render_test.ts
git commit -m "feat: expose tutorial hero loadout"
```

### Task 4: Phase A Verification and Checkpoint

**Files:**
- Modify: `TASKS.md`
- Modify: `PROJECT_STATE.md`
- Test: all local verification surfaces.

**Interfaces:**
- Consumes: verified Phase A implementation and commit hashes.
- Produces: accurate P4T-06F1/F4/F5 status and partial P4T-06F6 checkpoint.

- [ ] **Step 1: Run formatter on changed TypeScript files**

```powershell
deno fmt supabase/functions/_shared/render/stage-card.ts supabase/functions/_shared/render/tutorial.ts supabase/functions/_shared/render/menu.ts supabase/functions/_shared/render/hero.ts tests/unit/render_test.ts tests/unit/progression_render_test.ts
```

Expected: formatter completes successfully.

- [ ] **Step 2: Run full local verification**

```powershell
deno task verify
```

Expected: formatting, lint, type checks, unit tests, and property tests all pass.

- [ ] **Step 3: Audit forbidden-file scope**

```powershell
git diff --name-only 0abd4ce..HEAD
git diff --check 0abd4ce..HEAD
```

Expected: only allowed Phase A code/tests/docs appear; no whitespace errors.

- [ ] **Step 4: Update project memory**

Mark P4T-06F1, F4, and F5 implemented/locally verified. Mark P4T-06F6 as Phase A read-only access complete but interactive XP allocation still pending Phase B. Record that resolver thresholds, migrations, and locked day 1 were unchanged.

- [ ] **Step 5: Commit Phase A checkpoint**

```powershell
git add -- TASKS.md PROJECT_STATE.md
git commit -m "docs: checkpoint owner clarity phase a"
```

- [ ] **Step 6: Gate staging deployment**

Do not deploy yet. First write and self-review the separate Phase B implementation plan, implement it locally, and run the complete suite. Deploy A+B together to the already authorized staging-only project to avoid asking the owner to test a knowingly incomplete character menu twice.

## Self-Review

- Spec coverage: all Phase A acceptance criteria map to Tasks 1–4; Phase B, random discoveries, and story days are explicitly excluded.
- Placeholder scan: no TBD/TODO/“similar to” instructions remain.
- Type consistency: all public renderer signatures stay unchanged; the only new helper is private to `stage-card.ts`.
- Locked-scope check: migrations, resolver, config, golden vectors, and fallback day 1 are absent from the file list.
- Execution mode: the owner previously selected inline execution with checkpoint commits, so use `superpowers:executing-plans` and do not ask again.
