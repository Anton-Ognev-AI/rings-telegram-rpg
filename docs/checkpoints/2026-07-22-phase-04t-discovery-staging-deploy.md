# P4T-06 discovery staging deploy checkpoint

Status: `in_progress`; owner acceptance and Gate 4T.1 deletion/recovery closeout remain pending.

## Scope

- Target: the existing isolated owner-only app staging project.
- Recovery staging was read-only and remained unchanged.
- No production project, public user or external tester was used.
- Discovery C1 kept its approved boundary; migration 017 was not edited.

## Local gate

- Fresh local reset applied migrations 001–017 and canonical seed content.
- The clean 016→017 upgrade verifier preserved prepared run/callback state and restored the full schema.
- Migration 017 pgTAP: 21 assertions; Phase 4A DB: 16 tests; Phase 4T.0 DB: 9 tests.
- Two-day Telegram E2E passed from a clean database.
- Source gate: 215 unit and 3 property tests; schema lint and migration checksums passed.
- Staging preflight now fails closed unless migration 017 is present.
- The Windows upgrade verifier accepts the packaged `supabase-go.exe` fallback.

## Remote staging evidence

- Dry-run proposed exactly `202607190017_tutorial_field_discovery.sql`.
- Remote application history then matched local history exactly through 017.
- `day-publish-reset` and `outbox-worker` were deployed before `tg-webhook`.
- All three functions are `ACTIVE`; JWT verification is enabled for the two internal functions and
  disabled for the webhook as designed.
- Both internal functions returned 401 without authorization and 401 with anon authorization but no
  internal-secret header. The webhook returned 401 without its Telegram webhook secret.
- Remote-mode preflight returned `ready` with 9 checks, 19 migrations and 287 tracked files.
- The staging-only internal secret was rotated in memory and inherited only by the hidden runner;
  no secret file was created in the repository or Temp.
- Exactly one hidden owner runner was confirmed alive with empty stdout/stderr logs after startup.
- The isolated temporary Supabase link-workdir was deleted after migration verification.

## Remaining acceptance

1. In the private bot, start/resume the current Academy flow and confirm the amended clarity,
   character-management and discovery behavior.
2. Record the first discovery offer, equip/discard choice and next-stage stat effect.
3. Complete the isolated deletion/recovery/reconciliation drill.
4. Stop the runner, drain/reconcile the outbox, remove or explicitly retain staging, and write the
   final Gate 4T.1 checkpoint.
