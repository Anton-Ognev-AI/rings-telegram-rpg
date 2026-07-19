# Owner Smoke Clarity and Character Management Design

Date: 2026-07-19  
Status: approved by the owner's standing instruction to continue phase-by-phase after recording gameplay feedback  
Scope: P4T-06F1, P4T-06F4, P4T-06F5, and the safe first part of P4T-06F6

## Problem

The first real Telegram play-through exposed three immediate UX gaps:

- resolution cards print inactive combat effects as `+0`, making the player think they own vampirism or recovery;
- the final threshold is shown without explaining that the chosen approach already made the check easier or harder;
- earned XP and the first 20-XP purchase are correct in server state, but the interface does not show the remaining balance clearly or provide a persistent place to inspect and develop the character.

The same play-through also produced two larger product requirements: between-stage discoveries and connected story days. They are deliberately excluded from this amendment because ordinary reward offers need a forward data-contract change, while story rotation needs a content-publishing design. They remain P4T-06F2 and P4T-06F3.

## Design Principles

1. Server truth remains in the existing resolver and progression RPCs. Renderers explain results; they do not recalculate them.
2. Only owned or active effects are shown. Absence is expressed in the character loadout, not as fake zero-value combat bonuses.
3. Teacher guidance teaches the clue-to-action rule and relevant approach without normally naming the exact winning button.
4. Character development is available before an expedition. Spending XP after a run starts never mutates that run's immutable snapshot.
5. Auxiliary character-management callbacks are actor-, message-, action-, and profile-version-bound so stale presses cannot spend twice.
6. The first implementation is split into two independently testable phases and two commits.

## Phase A — Clarity and Read-Only Character Access

### Resolution card

- Always show the checked stat.
- Replace the dense formula line with:
  - the player's value and companion contribution;
  - the total;
  - the exact value required for success;
  - the positive margin or the missing amount.
- Read the selected choice metadata from the already supplied content and append one truthful explanation:
  - fitting/counter approach: the approach reduced the effective requirement;
  - risky/against-telegraph approach: the approach increased the effective requirement;
  - standard approach: the normal requirement applied;
  - neutral/trap choices: explain their non-check semantics without inventing a stat modifier.
- Do not expose internal config constants or reconstruct the numeric delta in the renderer.
- Render vampirism only when `vampHeal > 0` and recovery only when `postHeal > 0`. If both are zero, render neither.

### Teacher guidance

- Keep authored, deterministic guidance by encounter type.
- Full guidance explains the game rule: read the observation, match the action to the clue, and prefer the stat the action genuinely uses.
- The first lesson may be nearly direct; later guidance remains a hint, not an answer key.
- Light guidance reminds the player that a fitting approach lowers the effective requirement.

### XP clarity and navigation

- Every first-training option states its cost and the XP that will remain after purchase.
- The tutorial home/menu exposes `Герой` before both tutorial runs are complete.
- The Hero card is initially safe to open during onboarding and remains read-only in Phase A.

### Hero projection

- Show unspent XP first.
- Show base/effective characteristics and contribution breakdowns.
- Show all three equipment slots, including empty slots, because slot absence is useful loadout information.
- Show equipped rings or an explicit empty-ring state.
- Show only acquired active bonuses; never add zero-value vampirism or healing rows.

## Phase B — Interactive Character Management

### Entry and actions

- Add `Керувати XP` to the Hero card.
- Opening management renders affordable stat upgrades using the existing server forecasts and exact costs.
- Each option shows current value, next value, cost, and remaining XP.
- After a successful purchase, edit the same auxiliary Hero message with fresh values and fresh callbacks.
- The player can return to the normal Hero card or main menu at any time.

### Callback isolation

- Existing progression actions keep their `pa_` namespace and behavior unchanged.
- Hero-management actions use a distinct `hm_` namespace while resolving through the same canonical `resolve_player_action_v1` RPC.
- Tokens remain within Telegram's 64-byte limit and are bound to Telegram actor ID, profile version, message ID, and action identity.
- A repeated or stale token receives the normal stale-response recovery and cannot spend XP again.
- A successful profile mutation may request the canonical profile render, but the auxiliary Hero message is updated independently and must not overwrite the active expedition card.

### Snapshot rule

The active expedition snapshot is immutable. A purchase made from Hero management affects only the next newly created run. The UI must say this when an active run exists or retain the already established global explanation.

## Explicitly Deferred

### Phase C — Between-stage discoveries (P4T-06F2)

Design a forward migration starting at 017 for ordinary item/bonus offers. Preserve three equipment slots, no inventory, immediate equip/replace/discard, one blocking offer at a time, protected RNG, and a reward budget that does not flood every stage. The user's phrase “after each quest there is a chance” means an eligibility roll after each resolved stage, not a guaranteed drop.

### Phase D — Connected story days (P4T-06F3)

Create new content/day manifests rather than editing locked `content/fallback/case-001/day-01.json`. A day receives a named lesson arc, escalating practical scenes, a transition/payoff, and continuity hooks for the next day such as the forest expedition.

## Allowed Files

Phase A:

- `supabase/functions/_shared/render/stage-card.ts`
- `supabase/functions/_shared/render/tutorial.ts`
- `supabase/functions/_shared/render/menu.ts`
- `supabase/functions/_shared/render/hero.ts`
- directly corresponding unit/e2e tests
- phase checkpoint and project-memory documents

Phase B may additionally change:

- `supabase/functions/_shared/telegram/player-callback-token.ts`
- `supabase/functions/_shared/telegram/handler.ts`
- `supabase/functions/_shared/telegram/progression-router.ts`
- directly corresponding tests

## Forbidden Files and Behaviors

- no edits to migrations 001–016 or recovery migrations 001–002;
- no edit to resolver V1, locked balance config, golden vectors, or locked fallback day 1;
- no production deployment, production webhook, or external tester;
- no inventory, new table, new queue, or speculative framework in Phases A/B;
- no change to current reward probabilities or stage thresholds.

## Acceptance Criteria

### Phase A

1. A resolution with zero vampirism/recovery contains neither label.
2. A positive acquired effect is displayed and remains accurate.
3. Checked outcomes show total, requirement, margin/shortfall, and a metadata-backed approach explanation.
4. Teacher guidance explains how clue/action fit affects difficulty.
5. Every training purchase option shows remaining XP.
6. Tutorial navigation exposes a read-only Hero card.
7. Hero projection shows three equipment slots, rings, active bonuses, and free XP without fictitious effects.
8. Existing renderer and tutorial tests remain green.

### Phase B

1. Hero management prepares only server-forecast actions and exact costs.
2. A valid `hm_` callback spends XP once and refreshes the auxiliary card.
3. Actor, message, action, and profile-version mismatches are rejected.
4. A stale/replayed callback cannot spend XP again.
5. The active run card and active snapshot remain unchanged.
6. Reopening Hero recovers from Telegram edit failure using persisted server state.
7. Existing `pa_` progression behavior remains byte-for-byte compatible at its public boundary.

## Validation and Rollback

- Use test-driven development: add failing focused tests before each behavior change.
- Run focused unit tests after each slice, then the full local suite before committing.
- Deploy only to the authorized Supabase staging project after local verification.
- Owner-only Telegram smoke: open Hero during tutorial, inspect an empty loadout, spend XP, replay the old button, return to/resume the current expedition, and resolve one success and one failure.
- Rollback is code-only for Phases A/B: redeploy the preceding verified function bundle. No data rollback is required because no schema changes are introduced and canonical XP mutation remains the existing RPC.

## Self-Review

- Scope is split and all locked files are explicitly excluded.
- The renderer consumes content metadata only to explain the already returned server result.
- The proposed management surface reuses canonical mutation truth rather than adding another economy path.
- Failure recovery does not promise transactional Telegram edits; persisted state wins and reopening the card is the recovery path.
- Random rewards and story continuity remain visible requirements, not silently dropped work.
