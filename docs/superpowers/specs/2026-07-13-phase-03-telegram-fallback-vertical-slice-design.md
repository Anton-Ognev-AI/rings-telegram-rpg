# Phase 3 Telegram Fallback-First Vertical Slice Design

**Status:** approved for autonomous local implementation by the owner's standing Inline instruction
(ADR 034 and 2026-07-13 request). Remote Supabase changes, Telegram webhook registration, production
secrets, deployment, and tester invitations remain unauthorized.

## Purpose

Deliver the first persisted playable Telegram-shaped loop over the reviewed fallback dungeon:

`/start → Academy introduction → stage 1 … stage 5 mini-boss … stage 10 two-exchange boss → summary`,
with restart-safe resume, opaque callbacks, one editable card, deterministic Phase 1 outcomes,
atomic Phase 2 persistence, and explicit privacy/delete behavior.

This phase proves the transport and UX boundary. It does not add XP spending, items, rings, friends,
live generation, reminders, real Telegram credentials, or remote infrastructure.

## Evidence and council correction

The Phase 2 audit found no drift in locked migrations 001–008, the Phase 1 golden resolver, or
migration checksums. Fresh source verification passed `73` unit and `3` property tests. The local
database rerun could not start because the execution sandbox denied Docker Desktop named-pipe
access; the last clean Phase 2 checkpoint remains the database evidence until a later permitted
rerun.

The full five-advisor council returned `SPLIT_PHASE`. The original master Phase 3 mixed four
independently rejectable risks: database commands, Telegram ingress, outbox delivery, and
lifecycle/privacy gates. It also assumed identity and outbox commands that Phase 2 intentionally did
not expose. Implementing the original file list literally would pressure the Edge Function to bypass
the private-schema boundary.

Council-required correction:

1. add missing commands only through a new forward migration; never edit locked migrations 001–008;
2. execute three blocking gates: 3A contracts, 3B playable slice, 3C reliability/lifecycle;
3. preserve the locked Phase 1 resolver and golden hash;
4. turn the P01 findings into observable rendering acceptance criteria;
5. keep the complete phase local/fake until recovery-control and deployment receive separate
   approval.

## Considered approaches

### A. Thin Telegram adapter, pure application workflow, service-only RPC — selected

The public webhook verifies the Telegram secret before parsing. A thin grammY-compatible adapter
normalizes commands and callbacks into a small application command. Pure handlers render cards and
call narrow ports. State changes remain inside versioned `security definer` RPC transactions; the
outbox worker is the only component that sends or edits gameplay cards.

This preserves deterministic mechanics, makes Telegram failures testable, and keeps PII out of
durable outbox payloads.

### B. Edge Function directly queries private game tables — rejected

It would be shorter initially but would break the deny-by-default contract and duplicate transaction
logic in application code. It is incompatible with the reason Phase 2 exists.

### C. Put Telegram rendering and delivery orchestration in SQL — rejected

SQL could return ready-to-send messages, but it would couple Ukrainian copy, Telegram limits, token
preparation, and transport retries to migrations. Card UX should evolve without database migrations.

## Blocking gates

### Gate 3A — service contract expansion

Create migration `202607130009_telegram_commands.sql` and corresponding pgTAP/integration contracts.

The migration may add only Phase 3 transport state and versioned RPCs:

- idempotent Telegram identity bootstrap/lookup with minimum stored identity data;
- atomic V2 run start that enqueues the first canonical run-card intent;
- canonical run view for the owning player;
- outbox lease, retry, completion, and `delivery_unknown` transitions with a lease UUID;
- one run-card delivery record holding only internal run/player IDs and Telegram message ID;
- idempotent fallback-day publication, Kyiv lifecycle advancement, expiry, and explicit abandon;
- service-role-only execution, pinned search paths, and no direct table grants.

The existing outbox row must never durably contain Telegram ID, message text, button labels, or bot
credentials. The lease RPC may join the identity link at delivery time and return the target only to
the service caller.

Gate 3A is complete only after clean reset, checksum verification, pgTAP, integration/concurrency
tests, and proof that migrations 001–008 remain byte-identical.

### Gate 3B — local playable Telegram slice

Add focused modules with single responsibilities:

- `telegram/security.ts`: constant-work secret-header comparison and safe rejection;
- `telegram/update.ts`: minimal normalized command/callback input;
- `telegram/callback-token.ts`: deterministic opaque HMAC token and context hash;
- `telegram/port.ts`: answer/send/edit interface plus fake adapter;
- `telegram/handler.ts`: `/start`, expedition, resume, stale callback routing;
- `render/*`: introduction, menu, stage, outcome, boss, and summary cards;
- `application/run-view.ts`: projection/content mapping and preparation of every visible option;
- `tg-webhook`: HTTP composition root only;
- `outbox-worker`: claim → build canonical card → prepare actions → send/edit → complete;
- `day-publish-reset`: lifecycle RPC composition only.

The application imports the locked Phase 1 resolver. It calculates every offered option before
display, stores only the prepared resolution through the existing command port, and gives Telegram
only opaque callback data of at most 64 bytes.

### Gate 3C — lifecycle, privacy, delivery, and load proof

Prove:

- duplicate and competing callbacks still produce one effect and one canonical card;
- stale callback answers quickly and requests the current canonical card;
- retryable `429`, `500`, and pre-response failures retry with bounded backoff;
- an unknown result of a new send becomes `delivery_unknown` and is not blindly resent;
- an edit may be retried safely because it cannot create a second card;
- process restart and lost database/Telegram response resume from durable state;
- 23/25-hour Kyiv cycles, two-hour grace, expiry, abandon, and one run/cycle;
- `/privacy` is always readable and `/delete_me` uses begin → tombstone → finalize;
- callback acknowledgement p95 is below 2 seconds at 10 callbacks/s in the local fake-adapter
  harness.

No external tester is invited in Gate 3C. The master 5–10-person core-loop gate remains a later
owner-operated validation gate after a separately managed recovery store, staging deployment, and
real Telegram configuration exist.

## Database command shape

The exact migration may consolidate names, but the public surface must provide these
responsibilities:

- `telegram_identity_v1(external_id, create_if_missing)`;
- `start_run_v2(player_id, at, snapshots...)`;
- `run_view_v1(player_id, run_id?)`;
- `lease_outbox_v1(worker_id, limit, lease_seconds)`;
- `complete_outbox_v1(outbox_id, lease_id, result, telegram_message_id?, retry_at?)`;
- `publish_fallback_day_v1(at)`;
- `advance_day_v1(at)`;
- `abandon_run_v1(player_id, run_id)`.

All functions are owned by `postgres`, use `security definer`, pin
`search_path = pg_catalog, game, pg_temp`, reject anonymous/authenticated execution, and grant only
their exact signatures to `service_role`.

## Telegram and callback flow

1. Verify `X-Telegram-Bot-Api-Secret-Token` before parsing or logging the update.
2. Normalize only `/start`, `/privacy`, `/delete_me`, expedition/resume commands, and callback
   queries. Unknown input receives a short safe menu.
3. Answer callback queries immediately after syntactic validation; database work follows.
4. Bind a callback context hash to player, run, state version, stage/exchange, and choice. Do not
   bind to mutable message text.
5. Derive an opaque token from an injected HMAC key. Store only its SHA-256 hash in Postgres. The
   raw callback value contains no player/run/choice identifiers.
6. Resolve through `resolve_choice_v1`. `cached` repeats the prior result; `stale` requests the
   canonical card; `rejected` never mutates state.
7. The outbox worker renders the latest canonical state. A stale queued intent is completed as
   superseded and cannot overwrite a newer card.

## Card UX and P01 corrections

Every stage remains one editable Telegram card. The pre-choice card contains:

- expedition title, stage/exchange, lesson/practicum label, and encounter type;
- compact scene and visually separated observable clue;
- current HP and XP;
- two stat routes plus a safe neutral route without revealing which route succeeds;
- one set of inline buttons.

After choice, the same card shows:

- explicit outcome copy;
- the clue and rationale;
- for a check, `own + teacher/partner = total versus threshold` with the Ukrainian label
  `Спритність` for `agility`;
- exact HP movement, damage/healing, XP gained, and daily XP total;
- combat/boss damage breakdown when present;
- a single continue action to the next canonical stage.

This addresses P01's weak stat/combat visibility without making the pre-choice answer obvious.
Encounter-specific headings (`дослідження`, `практикум`, `переслідування`, `двобій`) and boss
layouts reduce visual monotony. Generic Academy roles are used in Phase 3; canonical named teachers
are deferred until a lore/content phase verifies them against the book source.

The final summary shows terminal result, deepest stage, remaining HP, earned XP, strongest
successful check, and a concrete next-day promise: the Academy opens a new expedition at 09:00 Kyiv
and progress remains. XP spending is described as locked for this transport proof; it is not faked.

## Error and privacy rules

- Never log bot token, secret header, service-role credential, raw callback token, Telegram ID,
  username, message text, or full update.
- Redact nested objects before diagnostic logging.
- Webhook authentication failure returns `401`; malformed authenticated input returns `400`; known
  duplicates/stale actions return `200` after safe handling.
- Telegram API errors are classified as retryable, permanent, or delivery-unknown.
- `/privacy` explains stored Telegram ID link, game progression, deletion behavior, and the lack of
  production deployment in local tests.
- `/delete_me` requires explicit confirmation and never reports completion before the external
  tombstone and finalization succeed.

## Allowed and forbidden scope

Allowed:

- new migration 009 and new pgTAP tests;
- new Phase 3 Telegram/render/application/Edge Function files;
- Phase 3 fixtures, E2E/load scripts, package/deno task lists, checksums, checkpoint docs, and
  project memory;
- targeted additions to existing ports/contracts needed by the new public RPC surface.

Forbidden:

- any byte change to migrations 001–008 or Phase 1 resolver/config/golden fixture;
- remote linking, migration, deployment, webhook registration, secret provisioning, real Telegram
  calls, or tester invitations;
- item, ring, XP-spending, friend, generator, reminder, leaderboard, or admin implementation;
- changes to locked `CLAUDE.md`.

## Acceptance

Phase 3 local implementation is complete only when:

- a synthetic Telegram identity can start and finish the fixed persisted fallback run through the
  fake adapter;
- stage 5 and both stage 10 exchanges render their distinct combat breakdowns;
- interruption/restart resumes the exact unresolved state;
- duplicate/stale callbacks cannot duplicate XP, results, or cards;
- one run has at most one Telegram card record and outbox failures follow the defined state machine;
- P01 visibility elements are asserted in render tests;
- privacy/delete and isolated recovery replay pass;
- lifecycle/property/load gates pass or are explicitly recorded as blocked by the local Docker
  permission boundary;
- migration checksums, the Phase 1 golden hash, format, lint, typecheck, and all runnable tests are
  clean;
- no remote system changed.
