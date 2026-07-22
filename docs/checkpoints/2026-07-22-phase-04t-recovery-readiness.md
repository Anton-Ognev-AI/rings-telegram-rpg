# P4T-06 recovery and runtime readiness checkpoint

Status: `in_progress`; the autonomous staging checks are complete, while owner acceptance and the
user-visible deletion/restore drill remain pending.

## Scope and decision

- Work stayed inside the two explicitly authorized owner-only staging projects.
- Production, external testers, locked migrations and gameplay mechanics were not changed.
- A five-role review returned `SPLIT_PHASE`: complete technical readiness now, but do not synthesize
  product acceptance, create a restore target early or trigger the owner's irreversible Telegram
  deletion.

## Recovery evidence

- Authoritative project metadata identified one app staging and one distinct recovery staging.
- Both projects were healthy; app staging retained exactly three active functions and recovery
  staging retained zero functions and zero secrets.
- A schema-only remote dump confirmed the locked recovery schema/table, the
  `record_deletion_tombstone_v1` security-definer RPC, its fixed search path, `postgres` owner,
  revoked public access and service-role-only execution.
- The recovery objects had been applied manually, so CLI migration history was empty. A RED dry run
  exposed the mismatch. After the exact schema proof, `migration repair` marked only
  `202607130001` and `202607150002` as applied; the GREEN dry run reported zero pending migrations.
  No schema or data changed.
- An anonymous recovery request was rejected with 401. A service-role invalid-UUID probe reached the
  RPC boundary and failed validation with 400 without creating a row.

## Runtime and backup evidence

- The staging-only internal secret was freshly rotated in memory without a repository or Temp
  secret file.
- One bounded `day-publish-reset` call returned `ok`.
- Two worker polls were both idle; aggregate totals were zero for leased, sent, retried, dead,
  delivery-unknown and superseded rows.
- No persistent runner is retained or claimed after the bounded drain. The operator must start and
  verify it again at the beginning of each real owner play window.
- Both staging backup APIs were reachable. Their backup arrays were empty, no usable physical backup
  was exposed and PITR was disabled. Therefore the deletion drill must capture an approved encrypted
  logical dump immediately before `/delete_me`, keep it outside the repository and destroy it after
  replay verification.

## Fresh local Docker gate

- The full Phase 4A verifier initially reproduced a Windows packaging defect: npm's Supabase shim
  assumed `supabase.exe`, while the installed 2.109.1 package contained `supabase-go.exe`.
- A focused RED→GREEN regression now resolves the packaged Windows binary through the shim's
  official `SUPABASE_CLI_BINARY_OVERRIDE`; the focused suite is 5/5.
- The complete 34-step gate then exited 0 in 497.4 seconds. It covered source checks, migrations
  001–017, pgTAP, integration/concurrency/deletion/recovery contracts, Telegram E2E, 6,000 synthetic
  callbacks, starter balance, reconciliation, database lint and migration checksums.
- Automatic cleanup was independently verified: zero TgGame containers remained.

## Remaining Gate 4T.1 boundary

1. Owner accepts the deployed clarity, character-management and first-discovery flow in Telegram.
2. Immediately before deletion, capture and verify the encrypted recovery point.
3. Create the denylisted disposable restore target without webhook/live traffic.
4. The owner reads `/privacy`, invokes `/delete_me` and confirms once.
5. Verify the live tombstone, restore only into the disposable target, replay twice, prove the
   identity-link count changes `1 -> 0`, then destroy the target and encrypted dump.
6. Drain/reconcile delivery state, decide whether staging is retained, and write the final Gate 4T.1
   checkpoint.

## Free-plan capacity amendment

- A fresh authoritative read found five projects total: two `ACTIVE_HEALTHY` and three inactive.
  The active pair is exactly app staging plus recovery staging; no disposable restore target exists.
- Supabase's current Free plan permits two active projects and does not count paused projects toward
  the limit. Therefore a third concurrent active restore target is unavailable without a temporary
  pause.
- Five-role review returned `APPROVE_WITH_SMALL_CHANGES`: after backup, live deletion/tombstone
  proof, outbox drain and webhook removal, pause app staging—not recovery—then create the target.
  Recovery stays active as the durable tombstone source.
- After replay proof, destroy the target. Resume and fully revalidate app staging only if the owner
  chooses to retain it; otherwise keep app staging paused with no webhook.
- A synthetic in-memory Windows DPAPI round-trip succeeded, proving that an operator-side encrypted
  recovery artifact is feasible. No gameplay data was read and no file was written during this
  capability check; the actual dump remains deferred until immediately before `/delete_me`.

## File hygiene

Phase-scoped review found no project deletion or archive candidates. Historical checkpoints and all
locked files stay intact; only current task/state/runbook truth was updated.
