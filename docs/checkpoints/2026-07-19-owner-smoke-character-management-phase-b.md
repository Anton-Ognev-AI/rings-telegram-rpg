# Owner Smoke Character Management — Phase B Checkpoint

Date: 2026-07-19  
Scope: interactive completion of P4T-06F6  
Status: implemented and locally verified; owner-only staging deployment/acceptance pending

## Delivered

- The ordinary Hero card exposes `Керувати XP` without preparing a mutation in advance.
- Opening management binds the current Telegram message ID and reads a fresh canonical `player_home_v1` projection.
- All four stat forecasts remain visible; only affordable server-forecast upgrades receive buttons.
- Equipped ring mastery is offered only when below 100% and affordable.
- Every affordable choice shows the exact cost and remaining XP; unavailable goals show the XP shortfall.
- New `hm_` HMAC callbacks are isolated from the existing `pa_` namespace and bound to player, profile version, message, and exact action.
- Applied, cached, and stale actions rebuild the same auxiliary Hero card from fresh canonical state.
- The router never requests an outbox run-card render for Hero management, so an active expedition card/snapshot is not overwritten.
- If the database mutation succeeds but Telegram edit fails, the repeated update resolves canonically as cached; reopening Hero is also a safe recovery path.

## Verification

- Focused handler/router gate: 30 passed, 0 failed.
- Callback token gate: 4 passed, 0 failed, both namespaces within Telegram's 64-byte limit.
- Full `deno task verify`: format, lint, type checks, 206 unit tests and 3 property tests passed.
- Phase B scope diff contains only its plan, Hero renderer, Telegram callback/router/handler, and their four unit-test files.
- `git diff --check`: clean.

## Preserved Boundaries

- No schema or migration changed; existing `prepare_player_action_v1` and `resolve_player_action_v1` remain the only mutation authority.
- Existing `pa_` functions and public behavior remain compatible.
- No resolver, balance, reward probability, golden vector, or locked content changed.
- No production or external tester was used.
- Active run snapshots remain immutable; purchases apply to the next newly created run.

## File Hygiene

The phase-scoped audit classified all changed code, tests, plans, and design documents as `KEEP`; project memory as `DOC_UPDATE`; and runtime dependencies as `SYSTEM_MANAGED_IGNORE`. There are no deletion/archive candidates.

## Next Safe Step

Run the existing staging preflight without exposing secrets, deploy the verified A+B Edge Function bundle only to the authorized owner-only app staging project, and ask the owner to exercise `/start` → `Герой` → `Керувати XP` plus one stale/replay attempt. P4T-06 remains open for the broader multi-cycle and deletion/recovery evidence.
