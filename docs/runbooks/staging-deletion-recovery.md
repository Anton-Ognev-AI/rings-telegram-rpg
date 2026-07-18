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
- Recovery migrations 001–002 are applied and the service-only RPC grant is verified.
- The app webhook has `RECOVERY_SUPABASE_URL` and the recovery project's service-role credential.
- The runner has no `delivery_unknown` or leased owner rows.
- A disposable restore target `<RESTORE_DRILL_REF>` is available and denylisted from normal bot use.

## Capture a Pre-Deletion Recovery Point

Before `/delete_me`, create an app-staging backup through the Supabase dashboard or an approved
encrypted dump outside the repository. Record only the backup timestamp/identifier in the operator
note. If a data dump is used, it contains Telegram linkage and must be encrypted, access-limited and
deleted immediately after the drill.

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

- Destroy the disposable restore target after recording aggregate proof.
- Securely delete any data dump and private operator note containing restore parameters.
- Keep the recovery tombstone; it is the durable deletion fence.
- Do not delete or rewrite recovery audit data to make a test repeatable.
- If replay fails, remove the Telegram webhook and treat restore readiness as failed.

Checkpoint evidence contains only backup timestamp/identifier, `1 -> 0` link counts, deletion state,
and pass/fail status. It must not contain the surrogate/deletion UUIDs, Telegram IDs, project refs,
database URLs or secret values.
