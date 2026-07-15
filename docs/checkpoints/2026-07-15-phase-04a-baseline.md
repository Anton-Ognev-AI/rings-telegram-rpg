# Phase 4A Baseline Checkpoint

**Date:** 2026-07-15

**Branch:** `codex/phase-04-onboarding-starter-build`

**Start commit:** `91c9a58` (`docs: approve Phase 4 execution plans`)

## Result

- `npm ci`: PASS from the committed lockfile.
- `npm run verify`: PASS in 13.9 seconds.
- `npm run verify:phase3`: PASS, all 21 historical steps, in 412.5 seconds.
- Full verifier covered source, pgTAP, Phase 2/3 integration and concurrency, deletion recovery,
  Telegram E2E, lifecycle, delivery faults, 6,000-callback load, reconciliation, DB lint and
  migration checksums.
- DB lint reported no schema errors.
- The verifier rejected remote configuration by design and stopped the local Supabase stack in
  `finally`.

The first full-verifier attempt failed before tests because managed sandboxing could not access the
Windows Docker named pipe. Docker Desktop 4.81.0 was then started locally and the identical guarded
verifier passed outside the sandbox. No repository change was used to bypass the guard.

## Locked SHA-256 Baseline

```text
981bd65bfac8a35b086e0d2f09ac70172a5ba0dd6798bfee38522eaa793dbc2a  supabase/migrations/202607120001_foundation.sql
f8ad71883ce062acfe99375ba1ec9c1387f0eb5ef90c597dbbd054d17dc1edbc  supabase/migrations/202607120002_config.sql
6b4a1a6b71212d0d141aa94ba9cb5f8298ef2c7de1ef1c10564e1fb1ea08df5e  supabase/migrations/202607120003_players.sql
7cb35ef634cdc5da6c1aa6fc900ca2ba8c824942d5f1fcae81afbdbbe584fd6b  supabase/migrations/202607120004_content.sql
27de83e6c8cd0e2249ca8f5e140592bc7ed8a189ade09e8bbfbbae918a3e6770  supabase/migrations/202607120005_xp.sql
c95b77cfcd0683c336cb9584590ac9edfcac82b6e04d0b8239ac674215250fec  supabase/migrations/202607120006_runs.sql
756470f16ad41d54745a3da084c2fabf3ee63347ac708aa0b367217d3a4b13a0  supabase/migrations/202607120007_actions_outbox.sql
e9d11d0add956cfd5d922adafe78117a7d2908c9d00be52eab162bec90c02e05  supabase/migrations/202607120008_core_commands.sql
b3ce2dc3b26d999a9ed510e3b63618db68f768c36b19966a8d441b51e3e22841  supabase/migrations/202607130009_telegram_commands.sql
f722a77f188f1a4ff200a930542d073bc951e46495b0b36d9fe09028b4ee2c30  supabase/migrations/202607130010_render_request.sql
67e8e15dc6aed07052e7ae8164db584d44f40a994622b529b4a1cafde82d6193  supabase/migrations/202607130011_telegram_deletion_identity.sql
1bf197731b7965ac3bf5afe4b08c0a66cdb3368533c598a69cee6e6818718c03  supabase/migrations/202607130012_deletion_outbox_fence.sql
b8b7af75921297966449644f360217dc8864acb64e1b308f17c71b006e44a78e  supabase/migrations/202607130013_outbox_dispatch_fence.sql
d7a1dacc4cd8b2e5d3633df2872511e61b1035881d17bad3b2e1fa1108394d70  supabase/functions/_shared/domain/resolvers/v1/combat.ts
fee44386575538bcef0be84807ebdec36596da5d493dceb9edbe1935a6231de4  supabase/functions/_shared/domain/resolvers/v1/config.ts
598e99b1d5e16ea828b08fd8641b4d3220ae58b45a93977ec2aeb41f42d691f1  supabase/functions/_shared/domain/resolvers/v1/party.ts
4e2d4904dfc36c070f0e575dc7a03e3f3cad41645c872fad3a07646430819428  supabase/functions/_shared/domain/resolvers/v1/resolver.ts
7a28ba23b3045c895c8edf90c594afb07f6ea91aef10b1bbf943ab50c3312162  content/schemas/dungeon-v1.schema.json
1a898630afcd321f46573f1c3523fda182cbba854825ebd1ba3c2a3214ab32bb  content/fallback/case-001/day-01.json
6d4deedc9d9e9aebe0943b30d2a142edfe84c4e21728ef6d8f69a193e48b4626  tests/fixtures/replays/v1/golden-full-run.json
8fa597ecebd30b88db68a3576adb161fc796358537535cb55deb2439d646be4b  tests/fixtures/replays/v1/golden-full-run.result.json
d3645baa75d174cb1fc025530cfe791b3e40c0da0df69a039637ce90316354af  scripts/verify-phase3.ts
```

## Next Gate

Gate 4.1 starts with executable RED contracts for migration 014, service-only progression RPCs and
global update-id atomicity. Production code must not be written before those tests fail for the
expected missing-feature reason.

