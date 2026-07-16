# PHASE-04-BALANCE Checkpoint

**Date:** 2026-07-16

**Status:** approved locally; fallback re-locked

## Outcome

The real reviewed fallback no longer makes the fire starter ring pairwise dominated. The amendment
changes one non-golden content route and the test-only informed-player simulation policy; it does
not change resolver numbers, starter-ring coefficients, migrations, golden fixtures or Telegram
runtime behavior.

## Implemented Scope

- `s3-magical.tacticalModifier` changed from `standard` to `counter`.
- The simulator now ranks check routes by the current party's actual
  `aggregate stat - CONFIG_V1 threshold` margin with original-array-order ties.
- The mixed policy uses the highest-margin remaining check on its alternate turns.
- Tests can run the same complete 72-cell matrix against an in-memory content value.
- Active fallback byte/canonical hash pins were updated without changing seed or verifier logic.

Implementation commits:

- `7760857 docs: plan fallback fire balance amendment`
- `30d0be3 fix: balance fallback fire route`
- `f0ee140 test: repin fallback content hash`

## TDD Evidence

- Initial focused RED: the informed score/selection/content-matrix exports did not exist.
- Policy-only regression: restoring only `s3-magical` to `standard` in memory preserves the exact
  old baseline pairs `weapon > fire`, `defense > fire`, `healing > fire`.
- Patched production fallback: baseline 24-cell pairs `[]`; full 72-cell pairs `[]`.
- Threshold parity is checked against the resolver-reported threshold; tie and mixed-alternative
  semantics are pinned.
- Source gate: `171` unit and `3` property tests passed; formatter, lint and type checks passed.
- Schema validator, 1,000-run determinism property and golden full-run test passed.

## Integrity Pins

```text
fallback file SHA-256:
6117820754d541ce901f9af70f4a73edae5974f1dd907b960e03cb495b9ac12c

fallback canonical payload SHA-256:
9000f0cebc29e6483b80de0bf8cf09c6f926821d317c17890654bc343fbb1c81

golden full-run transcript hash (unchanged):
1d63be460b0517de00bbd2c6ce2bc34e4236992d6d16d7252d2ec210ac20a3b0

golden result fixture file SHA-256 (unchanged):
8fa597ecebd30b88db68a3576adb161fc796358537535cb55deb2439d646be4b
```

Migrations 001-014, their checksum manifest, schema, resolver/config/party/combat and both golden
fixtures remained byte-identical.

## Runtime Verification

Two independent complete local-only verifiers passed:

1. `npm run verify:phase4a` — `31/31`, `527.5 s`.
2. `npm run verify:phase4a` — `31/31`, `503.3 s`.

Each verifier performed clean database resets, 325 pgTAP assertions, Phase 2/3/4 integration and
concurrency regressions, fallback/restart/privacy/two-day/tutorial-terminal/starter-build/grace/fault
E2E, reconciliation, DB lint, migration checksums and local cleanup.

An intermediate repeat stopped with npm `ENOSPC` after `C:` reached roughly 84 KiB free. Root-cause
inspection confirmed an infrastructure-only write failure after a successful clean reset. Only the
reproducible npm cache and verified old user-Temp `swap.vhdx` files were removed; no project, Docker
image, secret or gameplay data was deleted. The final independent verifier then passed. Future long
local gates should preflight at least 1 GiB free on `C:` even when Docker storage is on `D:`.

## Boundary and Next Step

`content/fallback/case-001/day-01.json` is re-locked at the new SHA. Remote Supabase projects,
migrations, secrets, Edge deployment, Telegram webhook and real bot calls were not used. The next
authorized step is PHASE-04T.0 local owner-smoke readiness; its Remote Approval Gate remains closed.
