# Phase 2 Persistent Atomic Core Design

**Status:** approved for autonomous local implementation under the owner's 2026-07-13 instruction; no remote migration or deployment is authorized.

## Purpose

Persist the Phase 1 deterministic kernel in local Supabase Postgres so one logical action can atomically change run state, append capped XP, cache its result, and enqueue one logical Telegram card. The same action must be safely replayable after duplicate callbacks, concurrency, or a lost HTTP response.

Phase 2 also establishes deletion semantics that survive an isolated app-database restore. It does not implement Telegram handlers, item/ring progression, content generation, reminders, deployment, or remote Supabase changes.

## Considered approaches

### A. Normalized private schema plus service-only command RPCs — selected

Game tables live in a non-exposed `game` schema. `anon` and `authenticated` have no table or function access. Small `public` command RPCs are `security definer`, pin `search_path`, validate all bound context, and own the complete transaction. This directly satisfies atomicity, idempotency, audit, and least-privilege requirements.

### B. Thin tables plus application-side multi-step writes — rejected

This is simpler initially, but a process crash between run update, XP ledger, and outbox writes can create irreconcilable partial state. It also makes 100 duplicate callbacks and two concurrent legal choices much harder to prove safe.

### C. Full event sourcing — rejected for MVP

An event stream could rebuild all state, but it would add projection/versioning machinery beyond the current need. Phase 2 needs an append-only XP ledger and immutable action cache, not event sourcing for every entity.

## Council-directed execution gates

Phase 2 remains one master phase but is implemented as three blocking internal gates:

1. **2A — schema and access boundary:** migrations 001–004, normalized identities/config/content, grants/RLS, clean reset, pgTAP.
2. **2B — atomic gameplay:** migrations 005–008, XP/run/action/outbox contracts, service RPCs, integration and concurrency tests.
3. **2C — deletion and recovery:** external tombstone store, primary deletion workflow, restore replay, reconciliation/checksum tools, final checkpoint.

Each gate gets its own commit and verification evidence. A failed gate blocks the next one.

## Database boundary

### Schemas and roles

- `game`: all application tables, internal functions, enums, and immutable records.
- `public`: only versioned command RPC entrypoints required by later Edge Functions.
- `extensions`: existing Supabase extensions only.
- `anon` and `authenticated`: no `USAGE` on `game`, no table privileges, no command RPC execution.
- `service_role`: executes explicitly granted public RPCs but receives no direct game-table DML.
- RPCs are owned by `postgres`, use `security definer`, and set `search_path = pg_catalog, game`.

RLS is enabled on game tables as defense in depth; direct privileges are revoked. Table-owner RPCs intentionally bypass RLS after validating the actor and bound command context.

### Migration order

| Migration | Responsibility |
|---|---|
| `202607120001_foundation.sql` | schemas, enums, timestamp helper, default privileges, deny-by-default grants |
| `202607120002_config.sql` | immutable `config_versions`, typed `feature_flags` |
| `202607120003_players.sql` | surrogate `players`, deletable `identity_links`, four `player_stats`, deletion state |
| `202607120004_content.sql` | immutable `content_versions`, `dungeon_days`, `fallback_content`, validated/open invariants |
| `202607120005_xp.sql` | `xp_accounts`, locked `player_cycle_xp_earnings`, append-only `xp_ledger`, internal capped delta function |
| `202607120006_runs.sql` | runs, self snapshots, loadout versions, stage results, one-nonterminal-run constraints |
| `202607120007_actions_outbox.sql` | action tokens, processed actions, outbox, typed analytics, immutable result cache |
| `202607120008_core_commands.sql` | service-only start/prepare/resolve/resume/deletion RPCs and transaction orchestration |

Migrations are forward-only. After the Phase 2 checkpoint their checksums are canonical; later changes use new expand-contract migrations rather than editing applied files.

## Minimal normalized model

Phase 2 creates only entities needed by the persistent vertical kernel:

- configuration: `config_versions`, `feature_flags`;
- identity: `players`, `identity_links`, `player_stats`;
- content: `content_versions`, `dungeon_days`, `fallback_content`;
- economy: `xp_accounts`, `player_cycle_xp_earnings`, `xp_ledger`;
- run: `runs`, `run_self_snapshots`, `run_loadout_versions`, `run_stage_results`;
- reliability: `action_tokens`, `processed_actions`, `outbox_messages`, `analytics_events`.

Items, rings, ranks, partnerships, notifications, weekly cases, chronicles, reward offers, broadcasts, and admin controls remain in later phases.

JSONB is limited to immutable content, snapshots, prepared deterministic resolution, cached command result, and outbox payload. Ownership, HP, phase, state version, XP balance, statuses, and uniqueness are typed columns.

## Immutable and uniqueness invariants

- one ordinary run per player and dungeon day;
- at most one nonterminal run per player across cycles via a partial unique index;
- one stage/exchange result per run;
- one XP account per player;
- one locked cap row per player/cycle;
- one ledger delta per `(source_type, source_id, reason)`;
- ledger rows cannot update or delete;
- account balance and cycle earnings cannot become negative or exceed configured limits;
- one action token hash per logical option;
- one processed row per action token and one per Telegram update ID;
- one logical outbox key per committed state change;
- validated/open content payloads are immutable and hash-pinned.

## Prepared-action contract

The database does not accept arbitrary resolution JSON at callback time.

1. The trusted application loads pinned content/config/self/party snapshots and resolves every offered option through the Phase 1 registry.
2. `prepare_action_v1` stores only the token hash, actor, run, expected state version, stage/exchange/choice, context hash, canonical resolution JSON, and Phase 1 resolution hash.
3. `resolve_choice_v1` accepts only token hash, Telegram update ID, actor player ID, and context hash.
4. The RPC checks cached processed action **before** stale-state checks. A replay of an already processed logical token therefore returns the exact stored result even after the run advanced or the retry carries a different update ID.
5. For a new token, the RPC locks token and run, validates actor/context/expiry/state version/phase, applies the prepared resolution, appends capped XP, inserts one stage result and one logical outbox card, increments state version exactly once, and caches the returned result in the same transaction.
6. A second legal token bound to the old state becomes `stale` with zero writes. A reused Telegram update ID bound to another token is `rejected` as `update_id_conflict`.

Command result status is one of `applied`, `cached`, `stale`, or `rejected`. Cached results preserve the original logical result body and hash.

## XP transaction

`game.apply_xp_delta_v1` is an internal function called only inside command RPCs. It locks the XP account and player/cycle earnings row, checks the 150 cap for `cap_subject` rewards, appends one signed ledger entry, and updates cached totals. Duplicate source/reason returns the existing logical delta rather than applying it twice.

No trigger silently invents XP. Reconciliation compares account balance and cycle earnings with ledger sums and exits nonzero on mismatch.

## Outbox contract

The resolve transaction inserts one `pending` outbox row with a unique logical key such as `run:{run_id}:state:{new_state_version}`. Phase 2 does not call Telegram. The payload identifies the canonical render intent and state/result IDs; Phase 3 will lease and deliver it.

## Deletion and restore boundary

Deletion uses three idempotent steps:

1. `begin_identity_deletion_v1` creates a deletion UUID and marks the surrogate player `deletion_pending`, immediately blocking further game commands.
2. `IdentityDeletionSink.recordTombstone` writes only `surrogate_player_id`, `deletion_id`, and timestamp to a separate recovery-control Postgres store. No Telegram ID, username, display name, or message is copied.
3. `finalize_identity_deletion_v1` verifies the deletion ID and removes `identity_links` plus allowed personal fields. Completion is reported only after the external tombstone and primary finalization both succeed.

If the external store is unavailable, the player stays blocked in `deletion_pending`; the workflow retries within the 24-hour SLA. If primary finalization fails after the tombstone write, retry is safe. After any isolated primary restore, tombstones replay before Telegram traffic and remove any restored identity links.

The recovery-control project uses separate local ports and its own migration. It is not linked to a remote project and is not restored from the primary backup.

## Application boundaries

- `start-run.ts`: validates/pins content/config/self snapshot and calls `start_run_v1`.
- `resolve-choice.ts`: finds the prepared action and calls `resolve_choice_v1`; it never performs table writes.
- `resume.ts`: reads only the service RPC projection required for the current canonical state.
- `delete-identity.ts`: orchestrates begin → external tombstone → finalize through an injected `IdentityDeletionSink`.
- `supabase.ts`: a narrow database port; tests use direct local Postgres, while later Edge code can supply a Supabase implementation.

Phase 1 resolver files remain unchanged and are consumed as a locked deterministic dependency.

## Test architecture

- pgTAP: schemas, grants, RLS, constraints, immutable content/ledger, XP cap and RPC access.
- Deno integration tests with pinned `npm:postgres@3.4.7`: start/resume, 100 duplicates, stale actions, tampered actor/context, cached-before-stale, lost response, reconciliation.
- Deno concurrency tests: two clients race the same token and two different legal tokens bound to the same state version.
- deletion E2E: synthetic identity deletion, isolated primary restore, recovery tombstone replay, proof that Telegram identity does not reappear.
- migration tools: ordered SHA-256 manifest, clean reset, and rejection of checksum drift.

Tests default only to the well-known synthetic local database URL. They refuse non-loopback hosts unless an explicit test-only override is supplied, preventing accidental remote writes.

## Failure handling and rollback

- No migration is applied outside local Supabase in Phase 2.
- Local data is synthetic and disposable; rollback is `supabase stop --no-backup` plus a clean reset from the previous Git checkpoint.
- No down-migration is authored.
- A failed internal gate leaves its worktree and branch intact for diagnosis; the previous gate commit remains runnable.
- The main branch is unchanged until the complete Phase 2 gate passes and is locally merged.

## Acceptance summary

Phase 2 is approved only when clean reset, pgTAP, integration, concurrency, checksum, reconciliation, deletion, and isolated restore tests pass; anonymous/authenticated access is denied; duplicate/stale/lost-response cases produce exactly one result/ledger/outbox effect; and no remote system changed.
