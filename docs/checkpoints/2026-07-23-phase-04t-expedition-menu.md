# Phase 4T — Expedition menu checkpoint

Date: 2026-07-23
Task: `P4T-06F9B`
Status: `deployed to owner-only staging; acceptance pending`

## Outcome

Active expedition cards now keep every inline quest choice and append one final `Меню`
row. The same exit is present on a resolved card that already contains the next stage, on a
terminal resolved card, and while a between-stage field discovery blocks progression.

The menu owns:

- `Повернутися в експедицію` when a run or pending field offer exists;
- `Герой`;
- `Академія`;
- `Допомога`.

These destinations are also available during the two tutorial days.

## Safety boundary

- Telegram receives one `InlineKeyboardMarkup`; no competing system reply keyboard occupies
  the input area or replaces the quest choices.
- `nav:menu` is static navigation. It does not prepare a `pa_` profile action, spend XP,
  accept/discard an item, resolve a choice, or write to the database.
- `nav:menu` has its own explicit read-only destination. It does not pass through canonical
  home recovery, because home correctly auto-renders an active run; only
  `Повернутися в експедицію` requests that canonical resume.
- Canonical home routing remains the recovery authority. Returning to the expedition
  requests the current run render; a blocked field discovery is rendered again instead of
  being skipped.
- Existing historical inline controls retain their canonical/stale behavior.
- No migration, resolver, mechanics config, locked content, recovery project or production
  state changed.

## Verification

- RED tests first pinned one final `Меню` row, unchanged `cb_` choice ordering, tutorial
  access to Academy, and a static menu route beside exactly two field-offer mutations.
- Focused render tests: `16 passed`.
- Focused field-router regression: `1 passed`.
- A pre-deploy audit found that the first implementation aliased `nav:menu` to `home`; a new
  RED handler regression reproduced the unintended `request_run_render_v2` call, then the
  explicit menu destination made the same regression GREEN.
- Full `deno task verify`: format, lint, type-check, `223` unit tests and `3` property tests
  passed.
- `deno check tests/e2e/fallback_solo_test.ts`: passed after the E2E choice selector was
  narrowed to `cb_` buttons, so navigation can never be mistaken for a gameplay choice.

## Deployment evidence and remaining boundary

Fail-closed remote preflight returned `ready` with 9 checks, 19 verified migrations and 296
tracked files. Only `outbox-worker`, then `tg-webhook`, were deployed to app staging; both
are `ACTIVE` at version 31 with JWT modes `true/false`, while `day-publish-reset` remained
internal-only. Required secret names are 7/7 and unauthenticated day/worker plus wrong-secret
webhook probes each returned 401. A fresh staging-only internal secret was rotated in memory
and the bounded no-cron runner is re-verified alive with an empty error log for this owner
play window.

Owner Telegram acceptance remains inside `P4T-06`. The session runner is not a persistent
service and must not be assumed alive after this window. Production and external testers
remain out of scope.
