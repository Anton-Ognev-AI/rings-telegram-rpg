# Phase 4T Gate 4T.0 — Local Readiness Checkpoint

Status: approved locally at this Git checkpoint; the mandatory remote approval gate remains closed.

## Outcome

The private owner-smoke path is ready for staging execution through the Telegram bot. Local work now
covers incident-bound delivery reconciliation, owner/private-chat ingress, offline fail-closed
staging tooling, isolated deletion recovery and operator runbooks. No remote Supabase project was
linked, no Edge Function was deployed, no webhook was registered and no real Telegram request was
sent.

The local gate exposed and closed one user-visible regression before staging: a run-only
`card_current` cache could suppress the next card after spending XP or accepting/discarding an item
or ring. Migration 016 now keeps ordinary current-card requests cached while a separate
service-role-only `request_profile_run_render_v1` records at most one edit per current
`profile_version`. There is no generic force-render switch.

## Local Deliverables

- `202607150015_owner_smoke_readiness.sql`: retained-incident reconciliation and append-only evidence.
- `202607150016_current_card_render_cache.sql`: current-card cache plus profile-version render request.
- Recovery migration 002 and fixed-origin recovery adapter carrying only surrogate/deletion IDs and
  a timestamp.
- Secret-first, owner-only, private-chat-only webhook composition; rejected ingress cannot construct
  privileged adapters or create an identity.
- Offline staging preflight and no-cron owner runner; remote mode needs a distinct command and
  `--execute-remote`.
- Runbooks for private staging, delivery-unknown decisions and deletion backup/restore replay.

## Verification Evidence

| Gate | Result |
|---|---|
| Source unit/property | `191 + 3`, green |
| pgTAP | 338 assertions, green |
| Phase 4T focused DB | 9 paths, green |
| Recovery RPC/restore | replay, conflict, concurrency and restore, green |
| Telegram E2E | fallback, restart, privacy/deletion, two-day tutorial, terminal, snapshot, lifecycle, delivery faults, green |
| Callback load | 6000 callbacks, green |
| Balance/reconciliation/lint/checksums | green / zero mismatch / clean / verified |
| Complete verifier | 34/34 steps, `516.4 s`; local stack stopped afterward |
| Tracked-set repeat | offline preflight `ready`, 18 migrations, 266 tracked files; fresh complete verifier exited `0` on 2026-07-18 |

The final verifier uses clean resets and verifies both upgrade paths 013→016 and 014→016. It also
distinguishes three contracts: no redundant edit for a current run card, one idempotent edit for a
new profile version, and retryable edit behavior for a genuinely stale card.

The 2026-07-18 repeat first reproduced an environmental Docker failure while the daemon was stopped,
then a sandbox ACL denial to the Windows Docker pipe. Starting the existing `D:\DockerDesktop`
installation and running the unchanged verifier in the approved elevated local context produced exit
code `0`; a subsequent status check found no local Supabase DB container, confirming cleanup.

## Integrity Anchors

- Locked migration 014 SHA-256: `66d42b4b3c00f47f294d70e5f316f8430810b877d0d25f03006b356bc6f7a713`.
- Active migration 016 SHA-256: `1ce4230c8918fe0f7025a9ee59115594234b95c659e39a8df3b9b0fdd7c3ef19`.
- Locked recovery migration 001 SHA-256: `464de9fe299b1c9c61a038cd93a6fd185189ec9f11f40f505663b31d73bfe2c8`.
- Recovery migration 002 SHA-256: `5e7dc026bdde18928185e06cbc05ef28c8e42782e2d298d67ea70f937f8c16d4`.
- Re-locked fallback SHA-256: `6117820754d541ce901f9af70f4a73edae5974f1dd907b960e03cb495b9ac12c`.

## Remote Stop Boundary

The repository-local `.env` remains ignored and was not read by Codex. A bot token in that file is
useful only after explicit staging authorization; deployment secret storage does not import it
automatically. The owner must provide the token to the approved staging secret command or dashboard
without pasting it into chat or logs.

Before a real Telegram test, explicit staging-only authorization must cover two isolated Supabase
projects, remote migrations, secret provisioning, function deployment, webhook registration and
Telegram calls. The exact order, proof and rollback steps are in the three Phase 4T runbooks.
