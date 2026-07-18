# Phase 4T Pre-Deploy Amendment

**Date:** 2026-07-18

**Status:** approved locally; remote approval gate unchanged

## Trigger

A five-role review of the executable Gate 4T.1 runbook found two mismatches before any remote action:

1. the staging preflight verified migrations, feature flag, refs and tracked secrets but did not pin
   the deploy-critical Edge Function JWT modes;
2. the remote scope named two staging projects while the approved deletion replay drill also needs
   one disposable restore target.

## Correction

- `preflightOwnerSmoke` now reads the tracked `supabase/config.toml` and fails closed unless
  `tg-webhook.verify_jwt=false`, `outbox-worker.verify_jwt=true` and
  `day-publish-reset.verify_jwt=true`.
- The restore target is explicitly part of the approval scope, is created only for the deletion
  drill, receives no webhook/live traffic and is destroyed after aggregate evidence is recorded.
- Secret provisioning is an owner/operator checkpoint. Codex does not read `.env`, the
  outside-repository Edge file or the command environment.
- No migration, fallback, resolver, gameplay coefficient, Telegram handler or remote system changed.

## Verification

- Focused RED proved the old preflight accepted unsafe JWT configuration.
- Focused GREEN: `6 passed, 0 failed` in the staging policy/preflight suite.
- Full source gate: `194` unit and `3` property tests passed; format, lint and type checks passed.
- Fully tracked offline preflight: `checks=9`, `migrationsVerified=18`,
  `trackedFilesScanned=270`, `mode=dry-run`.
- Dry-run runner: `dayCalls=0`, `workerPolls=0`, all delivery totals zero.
- `git diff --check` is clean; no network, secret or remote-system permission was used.

## Remote Boundary

Gate 4T.1 remains stopped. Explicit approval must cover the two isolated staging projects, the
temporary restore target, owner-operated secret storage, migrations, Edge deployment, webhook,
Telegram calls and cleanup. It must exclude production and external testers.
