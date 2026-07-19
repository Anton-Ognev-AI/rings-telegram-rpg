# Owner Smoke Character Management Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner deliberately spend XP from a secure Telegram Hero-management card while preserving canonical progression truth and immutable active-run snapshots.

**Architecture:** The read-only Hero card exposes a static `nav:hero-manage` transition. That callback supplies the auxiliary message ID, allowing the router to prepare actor/message/profile/action-bound `hm_` tokens through the existing `prepare_player_action_v1` and resolve them once through `resolve_player_action_v1`; successful or stale actions refresh the same auxiliary message from a fresh canonical home projection. Existing `pa_` actions and outbox-owned run cards remain unchanged.

**Tech Stack:** Deno 2, TypeScript, Supabase Edge Functions, existing progression RPCs, Telegram inline keyboards, HMAC-SHA-256 callback tokens.

## Global Constraints

- No migration, resolver, balance config, golden vector, locked content, production, inventory, or new persistence system.
- Existing `pa_` callback raw values, hashes, context versions, and handler behavior remain compatible.
- New Hero-management actions use `hm_` and stay within Telegram's 64-byte callback limit.
- Only server-returned training forecasts determine stat values and costs.
- Unaffordable actions are visible as goals but receive no mutation callback.
- A profile purchase never changes an already active run snapshot; it affects the next run.
- Telegram edit failure never rolls back persisted XP state; retry/reopen reconstructs the card from canonical home.

---

## File Structure

- `supabase/functions/_shared/render/hero.ts`: read-only Hero entry and interactive management projection.
- `supabase/functions/_shared/telegram/player-callback-token.ts`: backward-compatible `pa_` token helpers plus isolated `hm_` helpers.
- `supabase/functions/_shared/telegram/progression-router.ts`: prepare/refresh/resolve Hero management against canonical home.
- `supabase/functions/_shared/telegram/handler.ts`: route `nav:hero-manage` and `hm_` updates after owner identity resolution.
- `tests/unit/progression_render_test.ts`: management card copy/buttons.
- `tests/unit/player_callback_token_test.ts`: namespace, binding, size, and compatibility.
- `tests/unit/progression_router_test.ts`: canonical prepare/resolve/refresh/failure behavior.
- `tests/unit/telegram_handler_test.ts`: public callback routing and acknowledgement order.
- `TASKS.md`, `PROJECT_STATE.md`, `docs/checkpoints/...`: verified checkpoint.

### Task 1: Hero Management Renderer

**Files:**
- Modify: `supabase/functions/_shared/render/hero.ts`
- Test: `tests/unit/progression_render_test.ts`

**Interfaces:**
- Consumes: `freeXp`, `hasActiveRun`, four canonical stat forecasts, optional ring-mastery forecast.
- Produces: `renderHeroManagementCard(input): RenderedCard` and a static `nav:hero-manage` entry on `renderHeroCard`.

- [ ] **Step 1: Write failing renderer tests**

Add a `hm()` callback fixture and assert:

```ts
assertEquals(hero.buttons.flat().map((button) => button.callbackData).includes("nav:hero-manage"), true);
assertStringIncludes(management.text, "Керування персонажем");
assertStringIncludes(management.text, "Вільний досвід: 43 XP");
assertStringIncludes(management.text, "Фізична сила: 6 → 7 · 28 XP · залишиться 15 XP");
assertStringIncludes(management.text, "Поточна експедиція не зміниться");
assertEquals(management.buttons.flat().some((button) => button.callbackData === hm("physical")), true);
assertEquals(management.buttons.flat().some((button) => button.text.includes("Магічна сила")), false);
```

Use one affordable 28-XP option and one unaffordable 50-XP option; both stay visible in text, but only the affordable option becomes a button. Assert every callback is ≤64 bytes.

- [ ] **Step 2: Run focused renderer test and confirm RED**

```powershell
& '.\node_modules\deno\deno.exe' test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/progression_render_test.ts
```

Expected: type/check failure because `renderHeroManagementCard` does not exist.

- [ ] **Step 3: Add explicit management types and renderer**

Define:

```ts
export interface HeroUpgradeOption {
  readonly stat: "physical" | "magical" | "agility" | "vitality";
  readonly current: number;
  readonly next: number;
  readonly cost: number;
  readonly effect: string;
  readonly callbackData?: string;
}

export interface HeroManagementCardInput {
  readonly freeXp: number;
  readonly hasActiveRun: boolean;
  readonly options: readonly HeroUpgradeOption[];
  readonly mastery?: {
    readonly current: number;
    readonly cost: number;
    readonly callbackData?: string;
  };
}
```

Render exact canonical values, `залишиться ${freeXp - cost} XP` only for affordable options, `бракує ${cost - freeXp} XP` otherwise, optional mastery, the immutable-snapshot notice, and `nav:hero`/`nav:menu` navigation. Build mutation buttons only from defined callback data.

- [ ] **Step 4: Add the static management entry to Hero**

Before existing navigation, add:

```ts
[staticButton("Керувати XP", "nav:hero-manage")]
```

Do not prepare any profile action while rendering the ordinary Hero projection.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- supabase/functions/_shared/render/hero.ts tests/unit/progression_render_test.ts
git commit -m "feat: render secure hero management"
```

### Task 2: Isolated `hm_` Callback Tokens

**Files:**
- Modify: `supabase/functions/_shared/telegram/player-callback-token.ts`
- Test: `tests/unit/player_callback_token_test.ts`

**Interfaces:**
- Consumes: existing `PlayerCallbackBinding`.
- Produces: `deriveHeroManagementCallbackToken(key, binding)` and `hashHeroManagementCallbackForActor(raw, playerId)` while preserving existing exports exactly.

- [ ] **Step 1: Write failing namespace and compatibility tests**

Add assertions equivalent to:

```ts
const legacyBefore = await derivePlayerCallbackToken(key, binding);
const hero = await deriveHeroManagementCallbackToken(key, binding);
assertMatch(hero.raw, /^hm_[A-Za-z0-9_-]+$/);
assertEquals(encoder.encode(hero.raw).byteLength <= 64, true);
assertNotEquals(hero.raw, legacyBefore.raw);
assertEquals(await hashHeroManagementCallbackForActor(hero.raw, binding.playerId), {
  tokenSha256: hero.tokenSha256,
  contextSha256: hero.contextSha256,
});
assertEquals((await derivePlayerCallbackToken(key, binding)).raw, legacyBefore.raw);
```

Also prove `pa_` rejects `hm_`, `hm_` rejects `pa_`, and both namespaces reject malformed/oversized raw values.

- [ ] **Step 2: Run the token test and confirm RED**

```powershell
& '.\node_modules\deno\deno.exe' test tests/unit/player_callback_token_test.ts
```

Expected: import/type failure for missing Hero helpers.

- [ ] **Step 3: Implement separate context and signature versions**

Keep the current `PREFIX`, `player-callback-context-v1`, and `player-callback-token-v1` path byte-compatible. Add a private namespace-aware helper used by new exports with:

```ts
const HERO_PREFIX = "hm_";
const HERO_CONTEXT_VERSION = "hero-management-callback-context-v1";
const HERO_TOKEN_VERSION = "hero-management-callback-token-v1";
```

Derive the HMAC over the same binding fields and the Hero token version, prefix the 24-byte truncated signature with `hm_`, then hash with the Hero context version. Do not weaken key/binding validation.

- [ ] **Step 4: Run token tests and confirm GREEN**

Run the command from Step 2. Expected: all tests pass and legacy fixture remains unchanged.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- supabase/functions/_shared/telegram/player-callback-token.ts tests/unit/player_callback_token_test.ts
git commit -m "feat: isolate hero management callbacks"
```

### Task 3: Canonical Hero Management Router

**Files:**
- Modify: `supabase/functions/_shared/telegram/progression-router.ts`
- Test: `tests/unit/progression_router_test.ts`

**Interfaces:**
- Consumes: canonical `player_home_v1`, existing prepare/resolve action RPCs, `hm_` token helpers, and `TelegramPort.editMessage`.
- Produces: `openHeroManagement(dependencies, input)` and `handleHeroManagementCallback(dependencies, input)`.

- [ ] **Step 1: Write failing open-management test**

Script canonical home with `freeXp: 43`, four forecasts, and an active run. Call:

```ts
await openHeroManagement(dependencies(database, telegram), {
  playerId,
  chatId: 700000001n,
  messageId: 9001n,
});
```

Assert RPC order is `player_home_v1` then one `prepare_player_action_v1` per affordable stat (plus affordable mastery only when a ring exists), every prepared message is `9001`, actions exactly match the forecasts, output uses `hm_`, and Telegram performs one `editMessage`, not `sendMessage` or run-render RPC.

- [ ] **Step 2: Run router tests and confirm RED**

```powershell
& '.\node_modules\deno\deno.exe' test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/progression_router_test.ts
```

Expected: import/type failure for missing router entry.

- [ ] **Step 3: Implement canonical preparation and refresh**

Add an internal helper that parses fresh home; prepares `buy_stat` only when `cost <= freeXp`; prepares `train_ring_mastery` only when a ring exists, mastery is below 100, and canonical cost is affordable; derives `hm_` before calling the unchanged prepare RPC; renders all forecasts; and edits the supplied chat/message directly. Use the existing seven-day expiry and exact profile/message/action binding.

- [ ] **Step 4: Write failing resolve/replay/failure tests**

Cover these exact cases:

```ts
// applied or cached -> resolve, fresh home, fresh prepared actions, one edit
// stale -> no mutation retry, fresh home, fresh actions, one edit
// invalid/rejected -> one generic recovery card, no edit
// edit rejects after applied -> function rejects; retry with cached canonical result can refresh
```

Assert there is no `request_run_render_v2` or `request_profile_run_render_v1`; the auxiliary Hero card does not own an outbox run card.

- [ ] **Step 5: Implement resolve and refresh**

Hash only with `hashHeroManagementCallbackForActor`, call existing `resolvePlayerAction`, accept only `applied`, `cached`, or `stale`, then fetch canonical home and refresh the same message. On invalid/rejected input, send a generic card with `nav:hero`; never expose the reason. Do not consume `result.home` as client truth and do not retry a mutation in TypeScript.

- [ ] **Step 6: Run router tests and confirm GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- supabase/functions/_shared/telegram/progression-router.ts tests/unit/progression_router_test.ts
git commit -m "feat: route canonical hero upgrades"
```

### Task 4: Telegram Handler Routing

**Files:**
- Modify: `supabase/functions/_shared/telegram/handler.ts`
- Test: `tests/unit/telegram_handler_test.ts`

**Interfaces:**
- Consumes: normalized callback update, owner identity boundary, Phase B router functions.
- Produces: public routes `hero_management` and `hero_management_{applied|cached|stale|rejected}`.

- [ ] **Step 1: Write failing public-boundary tests**

Add one `nav:hero-manage` update and one `hm_...` update. Assert callback acknowledgement happens before identity/database work, only the linked owner profile is used, the source message ID reaches every prepared/resolved binding, and unrelated `hm_bad` yields generic recovery without creating an identity.

- [ ] **Step 2: Run handler tests and confirm RED**

```powershell
& '.\node_modules\deno\deno.exe' test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/telegram_handler_test.ts
```

Expected: current default routing treats the new callbacks as ordinary home navigation.

- [ ] **Step 3: Add explicit handler branches**

After callback acknowledgement, handle `nav:hero-manage` by resolving an existing identity with `create=false`, then open management for `update.messageId`. In the default branch, route `hm_` through the same existing-identity boundary and `handleHeroManagementCallback`. Do not reuse `routeProgression` because management must retain the source callback message ID.

- [ ] **Step 4: Run handler and router tests and confirm GREEN**

```powershell
& '.\node_modules\deno\deno.exe' test --allow-env=INTERNAL_FUNCTION_SECRET tests/unit/telegram_handler_test.ts tests/unit/progression_router_test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- supabase/functions/_shared/telegram/handler.ts tests/unit/telegram_handler_test.ts
git commit -m "feat: handle Telegram hero upgrades"
```

### Task 5: Full Verification, Memory, and Staging Gate

**Files:**
- Modify: `TASKS.md`
- Modify: `PROJECT_STATE.md`
- Create: `docs/checkpoints/2026-07-19-owner-smoke-character-management-phase-b.md`

**Interfaces:**
- Consumes: verified Phase A+B commits.
- Produces: locally complete P4T-06F6 and a bounded staging-deploy decision.

- [ ] **Step 1: Format changed TypeScript/tests**

```powershell
& '.\node_modules\deno\deno.exe' fmt supabase/functions/_shared/render/hero.ts supabase/functions/_shared/telegram/player-callback-token.ts supabase/functions/_shared/telegram/progression-router.ts supabase/functions/_shared/telegram/handler.ts tests/unit/progression_render_test.ts tests/unit/player_callback_token_test.ts tests/unit/progression_router_test.ts tests/unit/telegram_handler_test.ts
```

Expected: successful formatting.

- [ ] **Step 2: Run complete local verification**

```powershell
& '.\node_modules\deno\deno.exe' task verify
```

Expected: format, lint, type checks, all unit tests, and all property tests pass.

- [ ] **Step 3: Audit scope and callback safety**

```powershell
git diff --name-only c631fc6..HEAD
git diff --check c631fc6..HEAD
```

Expected: only Phase B allowed files/tests/plan appear, no locked files, no whitespace errors. Focused tests prove both namespaces ≤64 bytes and old `pa_` compatibility.

- [ ] **Step 4: Update project memory and checkpoint**

Mark P4T-06F6 locally implemented, recording that active snapshots remain immutable, only affordable canonical forecasts get callbacks, and Telegram edit recovery is canonical reopen/retry. Do not mark the three-cycle owner-smoke complete.

- [ ] **Step 5: Commit Phase B checkpoint**

```powershell
git add -- TASKS.md PROJECT_STATE.md docs/checkpoints/2026-07-19-owner-smoke-character-management-phase-b.md
git commit -m "docs: checkpoint character management phase b"
```

- [ ] **Step 6: Run the existing staging preflight before any deploy**

Use only the already documented, owner-authorized app/recovery staging project refs and secret files. Do not read or print `.env` values. If preflight is clean, deploy only the function bundle required by the existing staging runbook, preserve the owner-only webhook, and do not touch production.

- [ ] **Step 7: Owner-only Telegram acceptance**

Ask the owner to open `/start` → `Герой` → `Керувати XP`, verify the exact remaining XP, buy one stat, press the old button again, return to the active expedition, and resolve one stage. Record screenshots/evidence; do not treat this as the remaining multi-cycle/deletion closeout.

## Self-Review

- Spec coverage: secure XP allocation, exact forecasts/costs, stale/replay safety, auxiliary-message recovery, active-snapshot immutability, and legacy callback compatibility all map to explicit tasks.
- Placeholder scan: no TBD/TODO/“similar to” instructions remain.
- Type consistency: `HeroUpgradeOption`, `HeroManagementCardInput`, two `hm_` helpers, and two router entry points have one exact definition each.
- Architecture check: no new database truth, table, queue, or outbox owner is introduced.
- Risk check: the highest-risk case—DB mutation succeeds while Telegram edit fails—is idempotent because the same update resolves as cached and every reopen reads canonical home.
- Execution mode: continue inline with TDD and checkpoint commits under the owner's standing authorization.
