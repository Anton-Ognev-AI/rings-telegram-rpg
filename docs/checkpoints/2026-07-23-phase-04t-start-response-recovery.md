# Phase 4T — `/start` response recovery checkpoint

Date: 2026-07-23
Tasks: `P4T-06F9C`, `P4T-06R5`
Status: `deployed to owner-only app staging; acceptance pending`

## Incident evidence

- The owner's 07:33 `/start` reached app-staging `tg-webhook` and returned HTTP 200.
- The active run already had a current Telegram card and profile version, so
  `request_run_render_v2` correctly returned cached `card_current` and created no new outbox
  intent.
- Because that card predated the expedition-menu deployment, the owner saw no visible response
  and had no current navigation button.
- The bounded no-cron runner had exited at 07:13 after one transient `outbox-worker` HTTP 500.
  A later direct worker probe returned HTTP 200/`ok`, proving that the single failure was not a
  sustained outage.

## Bounded correction

- Canonical run rendering, migration-016 cache semantics and outbox idempotency are unchanged.
- A clean active `/start` sends the read-only menu directly after the canonical render request.
- Pending tutorial item/ring decisions still take precedence and are not covered by the menu.
- A blocked field-item decision may expose the menu because explicit resume restores that exact
  pending offer.
- The owner runner tolerates one or two consecutive worker failures, keeps the normal two-second
  polling interval, resets the failure counter after success and exits with the same generic
  redacted error on the third consecutive failure.

## Verification

- RED first reproduced a cached/current active card with zero Telegram response.
- RED first reproduced termination after one transient worker 500.
- Focused tests are GREEN for cached `/start`, pending-decision precedence and transient recovery.
- Full `npm run verify` is GREEN: formatting, lint, type checks, `225` unit tests and `3` property
  tests.
- `git diff --check` is clean.
- Five-role deployment council verdict: `APPROVE_WITH_SMALL_CHANGES`.

## Safety boundary

- Deploy only `tg-webhook`; the runner correction is local operator code.
- Do not change or redeploy migrations 001–017, resolver V1/config, locked content, recovery or
  production.
- Repeat fail-closed app-staging preflight, webhook negative-auth and active-function checks.
- Restart one bounded owner-only runner, then ask the owner to send `/start` once.

## Deployment evidence

- Fail-closed remote preflight is GREEN: 9 checks, 19 verified migrations and 297 tracked files.
- Only `tg-webhook` source was deployed. The subsequent staging-only in-memory internal-secret
  rotation advanced final remote versions to `day-publish-reset` 29, `outbox-worker` 34 and
  `tg-webhook` 35; all are `ACTIVE` with JWT modes `true/true/false`.
- Required staging secret names are 7/7. No secret value entered Git, project docs or command
  output.
- Unauthenticated day/worker requests and a wrong-secret webhook request returned 401 on the final
  versions.
- One fresh bounded owner runner is alive and its error log is empty.
- Owner acceptance requires one new `/start`; the earlier message cannot be replayed by the bot as
  an inbound user command.
