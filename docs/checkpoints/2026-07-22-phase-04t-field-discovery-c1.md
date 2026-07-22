# P4T-06F2 Discovery C1 checkpoint

Status: `approved locally`; staging acceptance remains part of P4T-06.

## Delivered boundary

- The first tutorial run can produce at most one protected field-item offer after stages 1–3.
- Chance bands are deterministic: `30/20/10%`, then `65/50/30%`, then stage-3 pity for
  success/neutral/failure.
- Only an empty `armor` or `talisman` slot is eligible; there is no inventory.
- A pending offer changes the run phase to `blocked_by_offer`. The next stage and its choice
  callbacks are unavailable until the player equips or discards the item.
- Accept creates append-only effective run build versions; the accepted bonus affects only the
  next unresolved stage. Discard resumes without creating a build version.
- Telegram edits the existing bound run card with the resolved result, exact item delta,
  equip/discard buttons and an explicit note about the next-stage effect.

General rarity, smart-loot, replacement of occupied slots and boss-drop pacing are deliberately
deferred to P4T-06F2D.

## Architecture and safety

- Forward-only application migration: `202607190017_tutorial_field_discovery.sql`.
- Versioned public contracts: `run_view_v3`, `prepare_action_v3`, `resolve_choice_v3` and
  `resolve_player_action_v2`; legacy behavior is delegated rather than copied into the client.
- Existing message-bound HMAC `pa_` actions are reused for accept/discard.
- Actor, callback message, context, replay, stale-profile and blocked-stage paths fail closed.
- Migrations 001–016, resolver V1/config/golden and the locked fallback content were not edited.

## Verification evidence

- Clean local migration application through 017 and clean 016→017 upgrade proof.
- Migration 017: 21 pgTAP assertions.
- Focused persistence integration: accept, discard, effective snapshot, replay and security paths.
- Source gate: 213 unit tests and 3 property tests.
- Two full two-day Telegram E2E scenarios pass, including the between-stage field decision,
  continued play, tutorial reward accept/discard and starter-ring selection.
- Database lint and migration checksum verification are green.

## Commits

- `c832f9b` — protected discovery planner.
- `7aeffb8` — persistence and migration 017.
- `e761eaa` — Telegram delivery and full flow wiring.

No remote staging or production mutation was performed for C1. Migration 017 is locked after
this checkpoint; further schema changes require a new forward migration.
