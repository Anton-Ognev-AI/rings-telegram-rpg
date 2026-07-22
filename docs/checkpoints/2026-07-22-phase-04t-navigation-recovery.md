# Phase 4T navigation recovery checkpoint

Date: 2026-07-22  
Status: deployed to owner-only app staging; owner acceptance remains pending

## Incident and root cause

An old `Почати навчальну експедицію` callback created the next tutorial run while the
session-only outbox runner was no longer delivering. The run and its initial outbox intent were
durable, but no `telegram_run_cards` row existed yet. `request_run_render_v2` correctly returned
`card_unavailable`; the TypeScript router incorrectly promoted that expected transition state to an
exception, so Telegram retried a webhook that returned 500 and showed an endless spinner.

## Recovery rule

- A cached expedition start now routes through canonical resume instead of returning silently.
- Only the exact `card_unavailable` render rejection is recoverable. The bot sends a compact
  pending-delivery card with `Оновити`, `Герой`, and `До меню`.
- All other render rejections remain fail-closed.
- The recovery path never creates another run, duplicates the battle card, blindly retries a send,
  or adds another outbox intent.
- Locked migrations 001–017, resolver/config/golden files, and fallback content were not changed.

## Verification evidence

- Focused router and handler tests: 33 passed.
- Real local Postgres regression proves one active run, one pending initial render intent, zero run
  cards before delivery, and no duplicate state after an old callback is pressed again.
- The adjacent fallback/restart/privacy E2E sequence is isolated and green: 8 passed.
- `deno task verify`: 218 unit and 3 property tests passed.
- The repeated 34-step Docker gate exited 0 in 524.4 seconds, including migrations 001–017,
  pgTAP, integration/concurrency/recovery, Telegram E2E, 6,000 callbacks, balance,
  reconciliation, lint, and checksum verification.

## Staging evidence

- Deployment order was `outbox-worker` then `tg-webhook` in app staging only.
- Remote preflight returned ready with 9 checks, 19 migrations, and 289 tracked files.
- A memory-only internal-secret rotation was followed by successful day and worker probes.
- One hidden owner runner was re-verified alive with an empty error log for the current play window.
  It remains session-only and must not be assumed alive in a later session.
- Production, external testers, recovery schema/data, and Telegram ownership were untouched.

## Product follow-ups recorded, not bundled

- Prefer one persistent `Меню` control if it coexists cleanly with inline quest choices; the menu
  owns `Повернутися в експедицію`, `Герой`, `Академія`, and `Допомога`.
- Field loot is eligible only after a fully successful stage: fitting choice plus passed stat check.
  XP and HP consequences remain independent of loot eligibility.
- Simulate a larger expedition with geometric difficulty and compare daily-new content against a
  learnable weekly route with daily attempts/variation before changing locked mechanics or content.

## Next safe step

Continue owner acceptance through Telegram while implementing the separate player-facing stat
projection (F7) and balance simulations (F8/F10) locally. Gate 4T.1 still requires the ordered
deletion/recovery/reconciliation closeout.
