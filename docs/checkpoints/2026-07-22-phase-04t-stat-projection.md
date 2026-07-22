# Phase 4T player-facing stat projection checkpoint

Date: 2026-07-22
Status: display portion approved and deployed to owner-only app staging; balance amendments pending

## Player-facing rule

- Upgrade cards show the current and projected stat values, for example `Живучість: 5 → 6`.
- Relevant derived values are structured totals, for example `Максимум HP: 40 → 44` under the currently deployed prototype rule.
- Raw implementation labels such as `physical +1`, `magical +1`, `agility +1`, and `vitality +1` are not player-facing copy.
- The router derives totals from the canonical current build and the server-owned upgrade forecast; renderers do not recalculate game balance.

## Scope boundary

The requested `max HP = vitality × 10` rule is not silently substituted into the UI. It changes survivability, group HP, stage reach, and the value of defensive builds, so F7B/F8/F10 must first compare it with the approved prototype. Any accepted change will be forward-only in mechanics/config and the UI will then reflect the canonical result.

Locked migrations 001–017, resolver/config/golden files, fallback content, production, and recovery data were not changed.

## Verification

- Focused progression render/router tests: 23 passed.
- Source gate: 218 unit and 3 property tests passed.
- Formatting, diff whitespace, and locked-file audits passed.
- Deployment order: `outbox-worker` then `tg-webhook`, app staging only.
- Remote preflight: ready with 9 checks, 19 migrations, and 290 tracked files.
- The session-only runner was re-verified alive after deployment; it is not assumed to persist across sessions.

## Next safe step

Model HP scaling, a mild geometric XP-cost curve, and geometric expedition depth together. Preserve accessible stages 1–3/4, make stage 6 a real early achievement, and compare daily-new content with a weekly learnable route before changing locked mechanics or content.
