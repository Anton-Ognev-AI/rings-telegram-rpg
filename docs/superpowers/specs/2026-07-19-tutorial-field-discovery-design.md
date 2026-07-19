# Tutorial Field Discovery C1 Design

## Goal

Give a new player one meaningful between-stage discovery during the first tutorial expedition. The
discovery teaches the no-inventory equipment loop, immediately improves the next unresolved stage,
and cannot duplicate, strand, or replay-award the player.

This is the smallest playable slice of P4T-06F2. General post-tutorial loot, five rarity tiers,
boss rewards, rings as drops, and long-term bad-luck protection remain separate follow-up work.

## Player Experience

- After each of tutorial stages 1–3, the server performs a deterministic protected discovery check.
- The chance depends on the authored result: a successful approach receives the best chance, a
  neutral approach a middle chance, and a failed approach the lowest chance.
- Stage 3 is the pity boundary: if the player is alive and has not seen the discovery, it appears.
- The offer is one ordinary support item for an empty `armor` or `talisman` slot. There is at most
  one tutorial field discovery per player.
- The existing run card first states the stage result, then shows the item, exact stat delta, current
  item comparison, and two choices: `Вдягнути` or `Викинути`.
- There is no inventory. The next stage is not shown until the choice is resolved.
- Acceptance equips the item and updates the effective run build from the next unresolved stage.
  Discard resumes the run without changing the build.
- The guaranteed post-tutorial item chooses the still-empty support slot, so a field discovery never
  turns the later reward into an exact duplicate.

## Determinism and Protection

The discovery roll is derived from `run_id`, resolved stage, outcome, and a version label. No client
randomness or mutable RNG state participates. The probability table is:

| Resolved stage | Success | Neutral | Failure |
|---:|---:|---:|---:|
| 1 | 30% | 20% | 10% |
| 2 | 65% | 50% | 30% |
| 3 | 100% | 100% | 100% |

The table is evaluated only when all of these are true:

- the run is the player's first tutorial assignment;
- the resolution was applied, nonterminal, and advanced to stages 2–4;
- no tutorial field discovery exists for the player;
- no other offer is pending;
- at least one support slot is empty.

The selected slot is also deterministic. If both support slots are empty, a separate versioned hash
chooses one. If one is occupied, the other is selected.

## Server Authority and State

Migration 017 is forward-only and does not edit migrations 001–016. It adds:

- `field_item` as a constrained offer kind with a single per-player field-discovery index;
- an append-only `run_self_versions` table paired with existing `run_loadout_versions` versions;
- `game.run_projection_v2`, which returns the latest effective self/loadout pair and falls back to
  the original immutable snapshots for all existing runs;
- `prepare_action_v3`, `resolve_choice_v3`, `run_view_v3`, and `resolve_player_action_v2` contracts.

`resolve_choice_v3` preserves resolver V1 output and tutorial rescue semantics, then creates and
blocks on at most one discovery. `prepare_action_v3` rejects stage actions while blocked.
`resolve_player_action_v2` delegates all legacy actions to V1 and owns only `field_item` resolution.

Acceptance writes permanent equipment, computes the canonical build, appends matching self/loadout
version 2, adjusts group max HP by the self max-HP delta, increments run/profile versions, unblocks
the run, and queues exactly one render. Discard performs only the version/unblock/render transition.
Both paths use the existing actor/message/context HMAC binding and processed-action replay ledger.

## Telegram Boundary

The outbox worker recognizes `phase = blocked_by_offer`, fetches canonical home state, prepares the
same `pa_` accept/discard actions bound to the existing run-card message, and renders the discovery
instead of preparing next-stage choices. After resolution, the normal resolved-stage-plus-next-stage
card replaces it. Delivery failure is recovered by the existing outbox retry and cached callback
paths; Telegram never decides item contents or stat values.

## Scope

Allowed:

- one new migration 017 and its checksum;
- forward RPC/type/application changes;
- item-offer renderer and progression/outbox routing;
- focused unit, pgTAP, integration, and upgrade tests;
- TASKS, PROJECT_STATE, ADR, plan, and checkpoint documents.

Forbidden:

- editing migrations 001–016, recovery migrations, resolver V1/config/golden vectors, or locked Day 1;
- production, external testers, inventory, general rarity catalog, boss loot, ring drops, or story-day
  generation;
- mutating an already stored baseline snapshot or trusting client-provided reward values.

## Acceptance Criteria

1. A first tutorial run receives at most one deterministic discovery and always by stage 3 if alive.
2. The card retains the stage outcome and clearly explains the no-inventory decision and next-stage
   effect.
3. No stage callback can be prepared while the run is blocked.
4. Accept equips exactly once, appends one effective build version, and the next check uses it.
5. Discard equips nothing and resumes exactly once.
6. Replay/stale/cross-actor/cross-message cases do not duplicate state or strand the run.
7. The later tutorial reward targets an empty support slot rather than offering an exact duplicate.
8. Existing runs and all legacy `pa_`/`hm_` behavior remain compatible.
9. Complete local verification and an upgrade-from-016 preservation test pass.

## Rollback

Before staging, take the already documented staging backup/restore point. If Edge behavior fails,
redeploy the last known-good function commit. Migration 017 is not downgraded; its new tables,
constraints, and versioned RPCs are additive and legacy V1/V2 contracts remain available.
