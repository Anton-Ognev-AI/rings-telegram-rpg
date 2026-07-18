# As-Built Architecture Truth Pass

Status: approved local documentation phase; no runtime, schema, content or remote change.

## Outcome

- Added root `ARCHITECTURE.md` with the actual data flow, authority boundaries, repository map,
  locked invariants, extension points and “where to change what” table.
- Updated the Phase-0 README to the locally approved Phase 4 / Gate 4T.0 state.
- Corrected two stale planned-stack claims: the current runtime uses a direct Telegram Bot API port,
  not grammY, and the owner-smoke uses a bounded no-cron runner, not `pg_cron`.
- Clarified the mixed mechanics boundary: pure TypeScript resolves deterministic outcomes; SQL RPCs
  own canonical atomic mutations; Edge/application code remains thin and RPC-only.
- Declared migrations 001–016 and recovery migrations 001–002 immutable after Gate 4T.0; future
  application schema changes start with a new forward migration 017+.

## Validation

- Every repository path and npm command named by the new documents exists.
- Markdown links resolve locally.
- No `.env`, credential value, real project ref or Telegram identifier was read or added.
- `npm run verify` remains the source gate; this documentation-only phase does not alter its inputs.

## Product Boundary

The architecture map does not authorize Phase 5 expansion. The next playable step remains the
separately approved owner-only Telegram smoke. Fun evidence from that smoke must inform any content,
progression or economy extension.
