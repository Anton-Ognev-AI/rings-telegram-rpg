# Staging Deletion and Recovery Replay Runbook

This drill proves that Telegram identity deletion survives restoration of a pre-deletion app backup.
It uses three isolated boundaries:

- app staging, which holds gameplay and Telegram identity linkage;
- recovery-control staging, which holds only surrogate player UUID, deletion UUID and timestamp;
- a disposable restore target, which is never used for live Telegram traffic.

Do not execute without explicit staging-only approval. Never restore into the live app staging or the
recovery project.

## Preconditions

- App and recovery refs passed the owner-smoke preflight.
- Recovery migrations 001–002 are applied, their remote migration history is exact, and the
  service-only RPC grant is verified.
- The app webhook has `RECOVERY_SUPABASE_URL` and the recovery project's service-role credential.
- The runner has no `delivery_unknown` or leased owner rows.
- Creation of a disposable restore target `<RESTORE_DRILL_REF>` is authorized. The Free plan allows
  only two active projects and the active app/recovery pair currently uses both slots; paused
  projects do not count toward that limit (see
  [Supabase billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase)).
  Do not create the target early. Free one slot only through the post-deletion app-pause sequence
  below, denylist the target from normal bot use, and never attach the Telegram webhook.

If recovery SQL was previously applied through the dashboard while CLI history is empty, do not
reapply it blindly. First compare a schema-only dump with the two checksum-pinned recovery
migrations and verify the RPC owner, fixed search path and grants. Only after an exact match may the
operator run `supabase migration repair 202607130001 202607150002 --status applied` from an isolated
workdir containing those exact migrations. A following linked dry run must report zero pending
migrations. This operation aligns migration metadata only; any proposed schema/data mutation is a
hard stop.

## Capture a Pre-Deletion Recovery Point

Immediately before `/delete_me`, create an app-staging backup through the Supabase dashboard or an
approved encrypted dump outside the repository. A successful backup-list API call is not proof that
a usable restore point exists; confirm an actual backup or capture the dump. Record only the backup
timestamp/identifier in the operator note. If a data dump is used, it contains Telegram linkage and
must be encrypted, access-limited and deleted immediately after the drill.

In the app SQL editor, record the owner's surrogate ID without selecting the external Telegram ID:

```sql
select player_id::text as surrogate_player_id
from game.identity_links
where platform = 'telegram';
```

Owner-only staging must return exactly one row. Store it only in the private operator session as
`<SURROGATE_PLAYER_ID>`.

## Execute User-Visible Deletion

1. In Telegram, send `/privacy` and verify the policy is readable.
2. Send `/delete_me`.
3. Press the generated confirmation button once.
4. Expected response: the Telegram link is removed and the profile is anonymized.
5. If the bot reports retryable/unavailable deletion, do not claim completion. Keep the profile
   blocked and repeat `/delete_me` only after recovery service health is restored.

Verify primary state without selecting external IDs:

```sql
select
  p.deletion_state::text,
  p.personal_label is null as label_removed,
  count(i.id)::integer as identity_links
from game.players p
left join game.identity_links i on i.player_id = p.id
where p.id = '<SURROGATE_PLAYER_ID>'::uuid
group by p.id;
```

Required: `deletion_pending`, `label_removed=true`, `identity_links=0`.

In the recovery project SQL editor, verify exactly one tombstone exists for the surrogate, selecting
only the three approved fields:

```sql
select surrogate_player_id::text, deletion_id::text, recorded_at
from recovery.deletion_tombstones
where surrogate_player_id = '<SURROGATE_PLAYER_ID>'::uuid;
```

Record its `<DELETION_ID>` and `<RECORDED_AT>` in the private operator session. No Telegram ID,
username, display name or message may exist in recovery control.

## Free-Plan Restore Slot

Do not pause either staging project before the deletion response and both database proofs above are
complete. Then:

1. Drain the owner outbox and require zero leased and `delivery_unknown` rows.
2. Remove the Telegram webhook with `drop_pending_updates=true`; verify Telegram reports no active
   webhook URL before making app staging unavailable.
3. Re-resolve projects from authoritative Supabase metadata. Require exactly one healthy
   `tg-game-app-staging`, one distinct healthy `tg-game-recovery-staging`, and no existing
   `tg-game-restore-*` project. Never use a remembered ref or a linked-worktree marker.
4. Pause **app staging** and confirm it becomes inactive. Do not pause recovery staging: it is the
   durable deletion fence and remains the source of the tombstone used for replay.
5. Create one disposable target named `tg-game-restore-<UTC timestamp>` with a fresh database
   password held only in the private operator process/session. Do not write it to the repository,
   checkpoint or shell history.
6. Confirm the target has no Edge Functions, secrets, webhook or live Telegram traffic before
   restoring any data.

Any unexpected project count/status, active webhook, pending delivery, target-name collision or
quota response is a hard stop. Resume app staging and re-run preflight if the drill cannot proceed.

## Isolated Restore and Tombstone Replay

1. Restore the pre-deletion app backup into `<RESTORE_DRILL_REF>` only.
2. Do not deploy the webhook and do not point Telegram at this project.
3. In the restore target, prove the old backup contains the link:

```sql
select count(*)::integer as links_before_replay
from game.identity_links
where player_id = '<SURROGATE_PLAYER_ID>'::uuid;
```

Expected: `1`. Apply the one-row equivalent of `scripts/recovery/replay-tombstones.ts` using the
three recovery values:

```sql
begin;

update game.players set
  deletion_state = 'deletion_pending',
  deletion_id = '<DELETION_ID>'::uuid,
  deletion_requested_at = '<RECORDED_AT>'::timestamptz,
  personal_label = null
where id = '<SURROGATE_PLAYER_ID>'::uuid;

delete from game.identity_links
where player_id = '<SURROGATE_PLAYER_ID>'::uuid;

commit;
```

Run the same replay transaction a second time; it must remain safe. Verify:

```sql
select
  p.deletion_state::text,
  p.personal_label is null as label_removed,
  count(i.id)::integer as links_after_replay
from game.players p
left join game.identity_links i on i.player_id = p.id
where p.id = '<SURROGATE_PLAYER_ID>'::uuid
group by p.id;
```

Required: `deletion_pending`, `label_removed=true`, `links_after_replay=0`.

## Replacement Identity Check

After the live app deletion is proven, the owner may send `/start` to create a new profile. Its
surrogate player ID must differ from `<SURROGATE_PLAYER_ID>`. The old tombstone is bound only to the
old surrogate and must not unlink the replacement profile.

## Closeout

- Destroy the disposable restore target after recording aggregate proof and confirm it no longer
  appears in authoritative project metadata.
- Securely delete any data dump and private operator note containing restore parameters.
- Keep the recovery tombstone; it is the durable deletion fence.
- Do not delete or rewrite recovery audit data to make a test repeatable.
- If replay fails, remove the Telegram webhook and treat restore readiness as failed.
- If owner-only staging is retained, resume app staging only after the target is gone; revalidate
  migration history 001–017, function/JWT modes, required secret names, recovery routing and a
  clean bounded queue drain before registering the owner-only webhook again.
- If staging is closed after the drill, leave app staging paused with no webhook and record that
  decision. Never delete app or recovery staging as an implicit cleanup shortcut.

Checkpoint evidence contains only backup timestamp/identifier, `1 -> 0` link counts, deletion state,
and pass/fail status. It must not contain the surrogate/deletion UUIDs, Telegram IDs, project refs,
database URLs or secret values.
