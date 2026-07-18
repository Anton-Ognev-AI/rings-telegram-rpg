# `delivery_unknown` Reconciliation Runbook

Use only for a new Telegram send whose transport result is ambiguous. Edits are retried by the
worker because an edit cannot create a duplicate card. Never convert an unknown new send into a
blind retry.

## Immediate Containment

1. Ctrl+C the local owner-smoke runner.
2. Do not call `outbox-worker` again.
3. If more than one owner row is unknown, remove the webhook and stop the smoke.
4. Work only in the confirmed app staging SQL editor. Never run these calls in recovery or
   production.

## Gather Incident-Bound Evidence

List only operational fields; do not select full payloads or identity external IDs:

```sql
select
  o.id::text as outbox_id,
  o.lease_id::text as delivery_incident_id,
  o.status::text,
  o.intent_type,
  o.attempts,
  o.dispatch_started_at,
  o.last_error_kind,
  o.payload->>'runId' as run_id,
  o.payload->>'stateVersion' as intended_state_version,
  o.updated_at
from game.outbox_messages o
where o.status = 'delivery_unknown'
order by o.updated_at;
```

For the selected `<OUTBOX_ID>`, record the retained `<DELIVERY_INCIDENT_ID>`. A missing lease ID is a
hard stop. Verify current state without exposing the Telegram external ID:

```sql
select
  p.deletion_state::text as player_state,
  p.id::text as player_id,
  r.id::text as run_id,
  r.state_version::text as current_state_version,
  exists (
    select 1 from game.identity_links i
    where i.player_id = p.id and i.platform = 'telegram'
  ) as identity_active,
  c.message_id::text as bound_message_id,
  c.last_state_version::text as bound_state_version
from game.outbox_messages o
join game.runs r on r.id = (o.payload->>'runId')::uuid
join game.players p on p.id = r.player_id
left join game.telegram_run_cards c on c.run_id = r.id
where o.id = '<OUTBOX_ID>'::uuid;
```

Do not make a decision if the row changed incident, left `delivery_unknown`, or the evidence query is
ambiguous.

## The Only Two Decisions

### A. `confirm_delivered`

Use only when there is direct evidence that Telegram accepted this exact send **and** the positive
numeric Telegram message ID is available from that evidence. Seeing similar text is insufficient.
Do not guess a message ID and do not derive it from an unrelated card.

```sql
select public.reconcile_delivery_unknown_v1(
  '<OUTBOX_ID>'::uuid,
  '<DELIVERY_INCIDENT_ID>'::uuid,
  'confirm_delivered',
  <POSITIVE_TELEGRAM_MESSAGE_ID>::bigint,
  clock_timestamp()
);
```

Expected: `status=applied`, outcome `delivered` or safe `superseded`. If
`repairRequired=true`, request one canonical repair after the card binding is committed:

```sql
select public.request_run_render_v2('<PLAYER_ID>'::uuid, '<RUN_ID>'::uuid);
```

Resume the worker only after the repair call returns `applied` or `cached`.

### B. `confirm_not_delivered_and_requeue`

Use only when controlled fault evidence proves Telegram did not accept the send—for example, the
test fault occurred before dispatch. Absence of a visible message is not proof.

```sql
select public.reconcile_delivery_unknown_v1(
  '<OUTBOX_ID>'::uuid,
  '<DELIVERY_INCIDENT_ID>'::uuid,
  'confirm_not_delivered_and_requeue',
  null,
  clock_timestamp()
);
```

Expected: `status=applied`; outcome is `requeued` only when identity, run intent and card state are
still current. Deleted, stale or already-bound state becomes `superseded` and is never requeued.

## Verify the Append-Only Result

```sql
select
  r.outbox_id::text,
  r.delivery_incident_id::text,
  r.decision,
  r.outcome,
  r.result->>'outboxStatus' as outbox_status,
  r.result->>'repairRequired' as repair_required,
  r.reconciled_at
from game.delivery_unknown_reconciliations r
where r.outbox_id = '<OUTBOX_ID>'::uuid
  and r.delivery_incident_id = '<DELIVERY_INCIDENT_ID>'::uuid;
```

Then verify the outbox row is `sent` or safely `pending` and no second card binding exists. An exact
repeat of the same decision is cached; a different decision for the same incident must reject as
`reconciliation_conflict`. Never edit or delete the audit row.

## Uncertain Evidence

If delivery cannot be proved either way:

- do not call the reconciliation RPC;
- keep the runner stopped;
- remove the webhook and end the owner smoke;
- retain the incident for investigation.

Safety takes priority over continuing the session. A stopped one-owner staging run is cheaper than a
duplicate canonical card or an incorrect binding.
