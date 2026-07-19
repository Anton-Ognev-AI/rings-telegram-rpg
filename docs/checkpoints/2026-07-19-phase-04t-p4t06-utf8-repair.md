# P4T-06 UTF-8 Staging Repair Checkpoint

**Status:** repaired and verified; P4T-06 remains `in_progress`.

## Incident

The first real owner expedition rendered its Academy header, teacher guidance and HP correctly, but
the fallback scene and all three choice labels were mojibake. The Telegram renderer was faithful:
the active staging `content_versions.payload` already contained the corrupted strings while its
declared canonical SHA incorrectly matched the reviewed local payload.

The corruption was reproduced exactly with Windows PowerShell 5.1 `Get-Content -Raw` against the
UTF-8-without-BOM fallback. `Get-Content -Raw -Encoding UTF8` and Deno both read the same locked file
correctly. The prior ad hoc staging import had therefore combined a wrongly decoded payload with a
SHA computed through a separate correct path.

## Repair

- Reconfirmed locked file SHA
  `6117820754d541ce901f9af70f4a73edae5974f1dd907b960e03cb495b9ac12c` and canonical payload SHA
  `9000f0cebc29e6483b80de0bf8cf09c6f926821d317c17890654bc343fbb1c81`.
- Inserted one append-only `fallback_validated` staging content version from the correctly decoded
  payload; the immutable corrupted row was not changed or deleted.
- In one transaction, rewired the fallback slot, current dungeon day and the one active owner run.
- The transaction required stage 1/state 0, exactly three unconsumed action tokens and zero
  processed actions. It removed only those three safe-to-reprepare tokens and enqueued one
  profile-version-bound repair of the existing Telegram card.
- The local source now rejects the characteristic Windows Cyrillic mojibake before database access;
  the operator runbook requires explicit UTF-8 and inspection of actual stored text, not only SHA.

## Evidence

- Telegram repair outbox: `sent=1`, `pending=0`, `failed=0`.
- Run/card state remained `0`; stage remained `1`; no gameplay progress was reset.
- Prepared actions after repair: `3`, all unconsumed, `0` processed, `0` suspicious prepared
  resolutions.
- Stored scene and all three labels are readable Ukrainian and the run references the repaired
  content version.
- Focused TDD: the new corruption fixture failed before the guard and passed after it.
- Full source gate: `npm run verify` exited `0` (format, lint, checks, unit and property tests).

## Next Safe Step

Continue the owner-only Cycle 1 expedition from the edited stage-1 card. P4T-06 still requires the
three-cycle product evidence plus the isolated deletion/recovery/reconciliation drill before Gate
4T.1 can close.
