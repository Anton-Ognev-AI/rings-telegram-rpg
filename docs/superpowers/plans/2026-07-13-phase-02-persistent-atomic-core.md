# Phase 2 Persistent Atomic Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** persist the locked Phase 1 resolver in local Supabase Postgres so a prepared player choice atomically advances one run, grants capped XP, records an immutable result, and enqueues one render intent exactly once under retries and concurrency; also make identity deletion survive an isolated primary restore.

**Architecture:** normalized state lives only in private schema `game`. The application calls narrow versioned `security definer` commands in `public`; no client role can read or mutate tables directly. The trusted TypeScript layer resolves choices before presenting them and stores a hash-bound prepared action. Callback resolution receives no arbitrary outcome payload. An append-only ledger and transactional outbox share the command transaction. A separate local recovery-control database stores only non-PII deletion tombstones.

**Tech Stack:** PostgreSQL 17/Supabase CLI 2.109.1, pgTAP, TypeScript/Deno 2.9.2, pinned `npm:postgres@3.4.7`, Web Crypto SHA-256, local Docker/Supabase only.

## Global Constraints

- Work only on branch `phase-02-persistent-atomic-core` in `.worktrees/phase-02-persistent-atomic-core`.
- Do not edit locked `CLAUDE.md`, Phase 1 resolver behavior, approved game specs, remote projects, or production systems.
- Tests reject non-loopback database hosts unless `ALLOW_REMOTE_TEST_DB=1`; the latter is never set during this phase.
- All migrations are forward-only and use names `202607120001` through `202607120008`; after the final checkpoint they are checksum-pinned.
- `game` is not an exposed API schema. `anon` and `authenticated` receive no schema/table/function access. `service_role` receives only explicit `EXECUTE` on public RPCs and no direct table DML.
- Every definer RPC is owned by `postgres`, validates actor and bound state, and sets `search_path = pg_catalog, game, pg_temp` with `pg_temp` last.
- RLS is enabled as defense in depth; table-owner RPCs intentionally bypass it. Default privileges remain deny-by-default.
- Callback-time `resolve_choice_v1` accepts only token hash, Telegram update ID, actor player ID, and context hash. It never accepts HP, XP, stage result, or arbitrary resolution JSON.
- Cached processed-token lookup occurs before stale-run validation. Duplicate, stale, tampered, lost-response, and concurrent calls must have exactly one state/ledger/outbox effect.
- XP is changed only through the append-only ledger path and is capped at 150 per player/cycle for cap-subject rewards.
- The recovery-control database contains only surrogate player UUID, deletion UUID, and timestamp—never Telegram ID, username, display name, or message data.
- Gate 2A must pass before 2B; 2B must pass before 2C. Each gate ends with verification, project-memory update, checkpoint document, and commit.

---

## Gate 2A — Schema and access boundary

### Task 1: Local database test harness and migration safety

**Files:**
- Modify: `package.json`, `deno.json`
- Create: `scripts/db/local-database.ts`
- Create: `scripts/db/run-pgtap.ts`
- Create: `scripts/db/migration-checksums.ts`
- Create: `tests/unit/local_database_guard_test.ts`

**Interfaces:**

```ts
export const PRIMARY_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export function assertLocalDatabaseUrl(url: string, allowRemote?: boolean): URL;
export async function withDatabase<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
```

- [x] Write RED tests proving loopback URLs are accepted while public hosts, malformed URLs, and non-Postgres schemes are rejected.
- [x] Add pinned `postgres@3.4.7` to `devDependencies`; add `db:start`, `db:reset`, `db:lint`, `test:db:unit`, `test:db:integration`, `test:db:concurrency`, `test:db:deletion`, `test:db`, `db:checksums`, and `verify:phase2` tasks without weakening existing `verify`.
- [x] Implement the URL guard and direct local connection helper; redact credentials from all errors.
- [x] Implement a pgTAP runner over the pinned local Postgres driver and propagate incomplete plans or `not ok` assertions as nonzero status. (`supabase test db` cannot run on this verified Windows stack because its pg_prove wrapper requires a standalone `docker` executable that Docker Desktop did not install in PATH; the same test SQL still runs against the local Supabase database.)
- [x] Implement ordered SHA-256 output for `supabase/migrations/*.sql`; before the final gate it may generate the manifest, afterwards verification compares it byte-for-byte.
- [x] Run `npm run verify` and the guard test. Expected: existing 60 tests plus new guard tests pass.

### Task 2: Foundation, schemas, enums, grants, and security tests

**Files:**
- Create: `supabase/migrations/202607120001_foundation.sql`
- Create: `supabase/tests/0001_foundation_security.test.sql`

**SQL surface:**

- Private schema `game`; revoke schema access from `public`, `anon`, `authenticated`, and `service_role`.
- Enums: `identity_deletion_state`, `content_validation_status`, `dungeon_day_status`, `run_status`, `run_phase`, `action_status`, and `outbox_status`.
- Internal `game.touch_updated_at()` and `game.reject_immutable_change()` functions.
- Explicit default privilege revokes for future tables, sequences, and functions.

- [x] Write RED pgTAP expectations for schema existence, enum labels, RLS helper posture, and absence of direct privileges.
- [x] Create the migration with explicit `REVOKE ALL`; no wildcard grants.
- [x] Add `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA game REVOKE ...` for tables, sequences, and functions.
- [x] Prove `anon`, `authenticated`, and `service_role` cannot use `game` or select/insert through it.
- [x] Run `npm run db:reset`, `npm run test:db:unit`, and `npm run db:lint`. Expected: clean reset, pgTAP pass, no error-level lint findings.

### Task 3: Immutable configuration and feature flags

**Files:**
- Create: `supabase/migrations/202607120002_config.sql`
- Create: `supabase/tests/0002_config.test.sql`
- Modify: `supabase/seed.sql`

**Tables:**

```text
game.config_versions(id uuid PK, version text UNIQUE, resolver_version text,
  payload jsonb, payload_sha256 text UNIQUE, daily_xp_cap integer,
  status text CHECK draft|active|retired, created_at timestamptz)
game.feature_flags(key text PK, enabled boolean, config_version_id uuid FK,
  updated_at timestamptz)
```

- [x] Write RED tests for unique version/hash, positive cap, immutable active payload, deny-by-default access, and one seeded active `resolver-v1/config-v1` row with cap 150.
- [x] Implement typed constraints and immutable trigger for active/retired config content; allow only the lifecycle transition `draft -> active -> retired`.
- [x] Seed deterministic config JSON from the exported V1 resolver values and assert its SHA-256 is stable.
- [x] Keep feature flags typed and small; seed disabled flags for generation, broadcast, drops, breakthroughs, partnerships, and reminders.
- [x] Reset and run pgTAP twice to prove idempotent seed behavior.

### Task 4: Players and identity isolation

**Files:**
- Create: `supabase/migrations/202607120003_players.sql`
- Create: `supabase/tests/0003_players.test.sql`

**Tables:**

```text
game.players(id uuid PK, deletion_state identity_deletion_state,
  deletion_id uuid NULL, deletion_requested_at timestamptz NULL,
  personal_label text NULL, created_at timestamptz, updated_at timestamptz)
game.identity_links(id uuid PK, player_id uuid FK ON DELETE CASCADE,
  platform text CHECK platform='telegram', external_id bigint,
  username text NULL, UNIQUE(platform, external_id))
game.player_stats(player_id uuid PK FK ON DELETE CASCADE,
  physical integer, magical integer, agility integer, vitality integer,
  defense integer, max_hp integer, CHECK all values >= 0)
```

- [x] Write RED tests for identity uniqueness, 64-bit Telegram IDs, nonnegative stats, deletion-state/deletion-ID coherence, cascades, RLS, and direct-access denial.
- [x] Implement surrogate identity separation. Telegram identifiers appear only in `identity_links`.
- [x] Add a constraint requiring deletion metadata exactly when state is `deletion_pending`; terminal `deleted` is represented by no identity link, not a fake external ID.
- [x] Seed one synthetic local player and identity only; use obviously fictional ID `900000000000000001`.
- [x] Reset, run pgTAP, and verify seed contains no real-looking personal data.

### Task 5: Validated immutable content and daily schedule

**Files:**
- Create: `supabase/migrations/202607120004_content.sql`
- Create: `supabase/tests/0004_content.test.sql`
- Create: `scripts/db/seed-content.ts`
- Modify: `supabase/seed.sql`

**Tables:**

```text
game.content_versions(id uuid PK, external_id text, schema_version text,
  resolver_version text, payload jsonb, payload_sha256 text,
  validation_status content_validation_status, validation_report jsonb,
  created_at timestamptz, UNIQUE(external_id, payload_sha256))
game.dungeon_days(cycle_id date PK, content_version_id uuid FK,
  opens_at timestamptz, closes_at timestamptz, grace_ends_at timestamptz,
  status dungeon_day_status)
game.fallback_content(slot text PK, content_version_id uuid FK)
```

- [x] Write RED tests for content hash uniqueness, immutable validated payload, Kyiv-local 09:00 boundaries (including 23/25-hour UTC DST cycles), `grace_ends_at = closes_at + 2h`, and open/ready days requiring validated or fallback-validated content.
- [x] Implement the migration, immutable trigger, and lifecycle constraints.
- [x] Add a script that validates `content/fallback/case-001/day-01.json` with the locked Phase 1 validator, computes canonical SHA-256, and emits deterministic SQL parameters rather than interpolated SQL.
- [x] Seed the reviewed fallback and one synthetic current day; assert stored hash equals the Phase 1 canonical hash for the content payload.
- [x] Verify `service_role`, `anon`, and `authenticated` still cannot directly read any `game` table.

### Task 6: Gate 2A verification and checkpoint

**Files:**
- Create: `docs/checkpoints/2026-07-13-phase-02a.md`
- Modify: `TASKS.md`, `PROJECT_STATE.md`

- [x] Run from a clean local stack: `npm run db:reset`, `npm run test:db:unit`, `npm run db:lint`, `npm run verify`.
- [x] Inspect grants with role impersonation; record exact passing counts and commands.
- [x] Record residual limitations: local-only, synthetic data, no gameplay mutations yet.
- [x] Mark P2-02 and P2-2A approved, P2-2B in progress; update architecture map.
- [x] Commit only Gate 2A files with message `feat: establish private persistent schema`.

---

## Gate 2B — Atomic gameplay commands

### Task 7: Append-only capped XP ledger

**Files:**
- Create: `supabase/migrations/202607120005_xp.sql`
- Create: `supabase/tests/0005_xp.test.sql`

**Tables and internal command:**

```text
game.xp_accounts(player_id uuid PK, balance bigint, lifetime_earned bigint,
  updated_at timestamptz)
game.player_cycle_xp_earnings(player_id uuid, cycle_id date, earned integer,
  PRIMARY KEY(player_id, cycle_id))
game.xp_ledger(id uuid PK, player_id uuid, cycle_id date, delta integer,
  applied_delta integer, cap_subject boolean, source_type text, source_id uuid,
  reason text, config_version_id uuid, created_at timestamptz,
  UNIQUE(player_id, source_type, source_id, reason))
game.apply_xp_delta_v1(...) returns jsonb
```

- [ ] Write RED pgTAP tests for append-only ledger, duplicate source idempotency, negative-balance rejection, exact cap 150, partial award at the cap edge, non-cap debit, and cached totals matching ledger sums.
- [ ] Implement row-lock order: account first, then cycle cap row, then ledger insert/update totals. Avoid deadlocks by never reversing it.
- [ ] Return requested/applied delta and whether the cap truncated it. Duplicate source returns the original applied delta with `cached=true`.
- [ ] Revoke direct function execution from all API roles; only definer command functions may call it.
- [ ] Run pgTAP and a 100-client direct internal-function race under owner-only test setup; prove one ledger row.

### Task 8: Version-pinned runs and snapshots

**Files:**
- Create: `supabase/migrations/202607120006_runs.sql`
- Create: `supabase/tests/0006_runs.test.sql`

**Tables:**

```text
game.runs(id uuid PK, player_id uuid, cycle_id date, content_version_id uuid,
  config_version_id uuid, status run_status, phase run_phase,
  state_version bigint, stage smallint, exchange smallint NULL,
  hp integer, max_hp integer, boss_hp integer NULL, xp_earned integer,
  started_at timestamptz, updated_at timestamptz, finished_at timestamptz NULL)
game.run_self_snapshots(run_id uuid PK, snapshot jsonb, snapshot_sha256 text)
game.run_loadout_versions(run_id uuid, version integer, snapshot jsonb,
  snapshot_sha256 text, PRIMARY KEY(run_id, version))
game.run_stage_results(run_id uuid, stage smallint, exchange smallint,
  choice_id text, resolution jsonb, resolution_sha256 text,
  created_at timestamptz, UNIQUE(run_id, stage, exchange))
```

- [ ] Write RED tests for stage 1–10, exchange 0–2, HP bounds, monotonic nonnegative state version, immutable snapshots/results, one ordinary run per player/day, and at most one active run per player.
- [ ] Use exchange `0` for ordinary stages so the uniqueness rule is a plain typed constraint.
- [ ] Ensure terminal statuses require `finished_at`, while active runs forbid it.
- [ ] Pin content/config/self/loadout hashes at run creation; later config/content changes cannot rewrite a run.
- [ ] Run pgTAP and verify Phase 1 files are byte-identical to the Phase 1 checkpoint.

### Task 9: Prepared actions, processed cache, outbox, and analytics

**Files:**
- Create: `supabase/migrations/202607120007_actions_outbox.sql`
- Create: `supabase/tests/0007_actions_outbox.test.sql`

**Tables:**

```text
game.action_tokens(token_sha256 text PK, player_id uuid, run_id uuid,
  expected_state_version bigint, stage smallint, exchange smallint,
  choice_id text, context_sha256 text, prepared_resolution jsonb,
  resolution_sha256 text, expires_at timestamptz, consumed_at timestamptz NULL)
game.processed_actions(id uuid PK, token_sha256 text UNIQUE,
  telegram_update_id bigint UNIQUE, status action_status,
  result jsonb, result_sha256 text, created_at timestamptz)
game.outbox_messages(id uuid PK, logical_key text UNIQUE, status outbox_status,
  intent_type text, payload jsonb, available_at timestamptz,
  lease_until timestamptz NULL, attempts integer)
game.analytics_events(id uuid PK, event_name text, player_id uuid NULL,
  run_id uuid NULL, properties jsonb, occurred_at timestamptz)
```

- [ ] Write RED tests for token/result/outbox uniqueness, immutable processed results, no raw callback token storage, valid hash lengths, expiry, nonnegative attempts, and analytics properties rejecting Telegram/username/message keys.
- [ ] Implement immutable triggers for action cache and applied stage results.
- [ ] Add `game.assert_prepared_resolution_v1(jsonb)` validating required status/HP/XP/stage/exchange/terminal fields and numeric bounds before storage.
- [ ] Store only SHA-256 token material. Outbox payload contains render intent and internal IDs, not PII.
- [ ] Prove no direct API-role access.

### Task 10: Service-only versioned RPCs and narrow TypeScript port

**Files:**
- Create: `supabase/migrations/202607120008_core_commands.sql`
- Create: `supabase/tests/0008_core_commands.test.sql`
- Create: `supabase/functions/_shared/application/database-port.ts`
- Create: `supabase/functions/_shared/application/start-run.ts`
- Create: `supabase/functions/_shared/application/prepare-action.ts`
- Create: `supabase/functions/_shared/application/resolve-choice.ts`
- Create: `supabase/functions/_shared/application/resume.ts`
- Create: `tests/unit/application_commands_test.ts`

**Public RPCs:**

```sql
public.start_run_v1(player_id uuid, cycle_id date, self_snapshot jsonb,
  self_snapshot_sha256 text, loadout_snapshot jsonb,
  loadout_snapshot_sha256 text) returns jsonb
public.prepare_action_v1(player_id uuid, run_id uuid, token_sha256 text,
  expected_state_version bigint, stage smallint, exchange smallint,
  choice_id text, context_sha256 text, prepared_resolution jsonb,
  resolution_sha256 text, expires_at timestamptz) returns jsonb
public.resolve_choice_v1(token_sha256 text, telegram_update_id bigint,
  actor_player_id uuid, context_sha256 text) returns jsonb
public.resume_v1(player_id uuid) returns jsonb
public.begin_identity_deletion_v1(player_id uuid, deletion_id uuid) returns jsonb
public.finalize_identity_deletion_v1(player_id uuid, deletion_id uuid) returns jsonb
```

- [ ] Write RED tests: only `service_role` executes RPCs; `anon`/`authenticated` fail; direct tables stay denied; functions are `security definer` with exact safe search path.
- [ ] Implement `start_run_v1`: validate active player/current schedulable day/validated content/active config, reject an existing active run, insert pinned run and snapshots atomically, and return canonical projection.
- [ ] Implement `prepare_action_v1`: validate active player, actor ownership, current stage/exchange/version, unexpired token, context hash, and prepared resolution shape; insert idempotently only if every field matches.
- [ ] Implement `resolve_choice_v1` in this order: lock token; return cached result before run stale checks; reject actor/context/expiry; reject conflicting update ID; lock run; validate active/version/stage/exchange; insert stage result; call XP delta; apply HP/boss/stage/terminal; increment state version once; insert one outbox logical key; cache canonical result; return `applied`.
- [ ] Implement stale and rejected returns without run/ledger/outbox/result mutation. A stale token may be recorded only as an immutable diagnostic processed result if doing so cannot collide with a future valid effect; default implementation returns without persistence.
- [ ] Implement `resume_v1` as a service projection with no table write.
- [ ] Implement deletion begin/finalize idempotently; every gameplay RPC rejects `deletion_pending` players.
- [ ] Grant `service_role` only these six RPCs. Revoke public execution explicitly after each creation.
- [ ] Define a generic `DatabasePort.call<Result>(rpc, args)` and small wrappers; unit-test exact parameters and prove wrappers perform one RPC call with no direct SQL/table method.

### Task 11: Integration, concurrency, and lost-response proofs

**Files:**
- Create: `tests/integration/helpers/database.ts`
- Create: `tests/integration/start_resume_test.ts`
- Create: `tests/integration/action_atomicity_test.ts`
- Create: `tests/integration/action_concurrency_test.ts`
- Create: `tests/integration/reconciliation_test.ts`
- Create: `scripts/db/reconcile.ts`

- [ ] Build fixtures using only synthetic player/content/config data and RPC calls where production would use them.
- [ ] Prove start/resume returns the same pinned content/config and state projection.
- [ ] Send 100 concurrent copies of one token. Assert one `applied`, 99 logical `cached`, one state-version increment, one stage result, one ledger row, and one outbox row.
- [ ] Race two different valid tokens bound to the same state version. Assert one `applied`, one `stale`, and exactly one effect set.
- [ ] Prove cached-before-stale by applying once, advancing the run, then replaying the original token with another update ID; the original canonical result/hash returns with `cached` and no writes.
- [ ] Simulate a lost HTTP response by committing through one client, discarding its return, reconnecting, and replaying; assert cached result and one effect set.
- [ ] Tamper actor and context. Use a token from another run/choice/version to demonstrate that callback-side substitution cannot cross the token binding. Assert `rejected` and zero writes.
- [ ] Reconcile every XP account/cycle cache against ledger sums and every applied action against exactly one stage result and outbox key; exit nonzero on mismatch.
- [ ] Run each concurrency case five times to expose timing-dependent defects.

### Task 12: Gate 2B verification and checkpoint

**Files:**
- Create: `docs/checkpoints/2026-07-13-phase-02b.md`
- Modify: `TASKS.md`, `PROJECT_STATE.md`

- [ ] Clean reset, then run `npm run test:db:unit`, `npm run test:db:integration`, `npm run test:db:concurrency`, `npm run db:lint`, `npm run verify`.
- [ ] Record test counts, race cardinalities, reconciliation result, and confirmation that callback RPC accepts no mutation payload.
- [ ] Mark P2-2B approved and P2-2C in progress.
- [ ] Commit only Gate 2B files with message `feat: add atomic persistent game commands`.

---

## Gate 2C — Deletion and recovery

### Task 13: Separate recovery-control database and deletion orchestrator

**Files:**
- Create: `recovery-control/README.md`
- Create: `recovery-control/migrations/202607130001_deletion_tombstones.sql`
- Create: `scripts/recovery/local-recovery-database.ts`
- Create: `scripts/recovery/replay-tombstones.ts`
- Create: `supabase/functions/_shared/application/delete-identity.ts`
- Create: `tests/unit/delete_identity_test.ts`

**Recovery table and application boundary:**

```text
recovery.deletion_tombstones(surrogate_player_id uuid,
  deletion_id uuid UNIQUE, recorded_at timestamptz,
  PRIMARY KEY(surrogate_player_id, deletion_id))
interface IdentityDeletionSink {
  recordTombstone(input: { surrogatePlayerId: string; deletionId: string;
    recordedAt: string }): Promise<void>;
}
```

- [ ] Write RED unit tests for begin -> sink -> finalize order, sink failure leaving the player pending, retry after sink success, and finalize failure retrying without a second logical tombstone.
- [ ] Create a minimal separate Postgres schema/migration and local URL on a port distinct from primary. Apply the same loopback-only safety guard.
- [ ] Implement sink with parameterized SQL and a unique deletion ID. Do not accept arbitrary metadata.
- [ ] Implement orchestrator with injected database port, sink, and clock. Never report completion until both durable steps succeed.
- [ ] Add a static test that recovery migration/schema contains none of `telegram`, `username`, `display_name`, `message`, or external identity columns.

### Task 14: Restore replay, deletion E2E, and canonical migration manifest

**Files:**
- Create: `tests/integration/deletion_restore_test.ts`
- Create: `tests/integration/recovery_schema_test.ts`
- Create: `supabase/migrations/SHA256SUMS`
- Create: `supabase/functions/_shared/contracts/database.types.ts`
- Modify: `scripts/db/migration-checksums.ts`

- [ ] Create a synthetic identity, begin deletion, persist external tombstone, finalize primary deletion, and prove all gameplay commands remain blocked/identity absent.
- [ ] Capture a primary-only dump before finalization, restore it into a disposable local primary database, replay tombstones before simulated traffic, and prove the restored Telegram link is removed.
- [ ] Repeat tombstone replay twice; prove it is idempotent.
- [ ] Generate local TypeScript database types after a clean reset with `supabase gen types typescript --local`; check them with Deno.
- [ ] Generate `supabase/migrations/SHA256SUMS`, then make checksum verification read-only. In a temporary copy mutate one migration and prove verification fails without touching canonical files.
- [ ] Run reconciliation after deletion and restored-primary replay; expected zero mismatches.

### Task 15: Final Phase 2 verification, review, and checkpoint

**Files:**
- Create: `docs/checkpoints/2026-07-13-phase-02.md`
- Modify: `TASKS.md`, `PROJECT_STATE.md`, `DECISIONS.md`

- [ ] Stop local stacks without backup; start clean primary and recovery stores; apply all migrations from zero.
- [ ] Run `npm run verify:phase2`, which includes format, lint, typecheck, Phase 1 tests, pgTAP, integration, five-pass concurrency, reconciliation, checksum, deletion, and isolated-restore tests.
- [ ] Inspect `git diff --check`, `git status --short`, migration ordering, grants, RPC search paths, and Phase 1 golden hash.
- [ ] Perform adversarial review of atomicity, access, deletion, and recovery evidence; fix only Phase 2 issues and rerun the full gate.
- [ ] Document exact command outputs, test counts, hashes, known limitations, no-remote-change proof, and rollback instructions.
- [ ] Mark PHASE-02/P2-2C approved, set the next master-plan phase as active but do not begin it in this commit, and add an ADR pinning migration checksums and RPC V1 contracts.
- [ ] Commit with message `feat: complete persistent atomic core`.

## Completion Contract

Phase 2 is complete only when a clean local rebuild passes every gate, API roles cannot access private state, 100 duplicates/two competing choices/lost responses create one logical effect, ledger and outbox reconciliation report zero mismatches, deletion survives isolated primary restore without storing Telegram identity in recovery control, migration checksums and generated types are current, Phase 1 golden behavior is unchanged, and no remote system was modified.
