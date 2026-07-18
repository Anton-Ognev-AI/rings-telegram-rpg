# Private Telegram Owner-Smoke Runbook

**Scope:** one owner, one private bot, one isolated app staging project and one isolated
recovery-control staging project.

**Current gate:** documentation only. Do not execute any command in the `Remote actions` sections
until the owner explicitly authorizes staging-only Supabase and Telegram use.

## Safety Rules

- Never paste a bot token, service key, webhook secret, owner Telegram ID or database password into
  chat, Git, command output or the checkpoint.
- Do not read or print `.env`. The owner's local `.env` is not automatically consumed by Supabase
  deploy or by the smoke runner.
- Keep app and recovery project refs different. Put known production refs in
  `TG_GAME_DENIED_PROJECT_REFS` with commas and no spaces.
- Link only the app project from this worktree. Apply recovery migrations in the recovery project's
  SQL editor; never run the app migration folder against recovery.
- Keep `tutorial_starter_enabled` absent/disabled until authenticated non-owner rejection is proven.
- Stop on any project-ref mismatch, secret in output, unexpected identity count, migration drift,
  `delivery_unknown`, or ambiguous deletion result.

## Architecture

```text
Telegram private chat
        |
        | secret-token webhook, owner/private-chat allowlist
        v
tg-webhook (app staging) ---- service-only RPC ----> app Postgres
        |
        | only surrogate UUID + deletion UUID + timestamp
        v
recovery-control Postgres (separate staging project)

local no-cron runner ----> day-publish-reset + outbox-worker ----> Telegram Bot API
```

Telegram is the game client. Supabase is authoritative for identity, progression, run state,
rewards, canonical cards and delivery state. The local runner only replaces cron during the private
smoke; it does not own gameplay state.

## Required Values

Store values outside the repository and expose them only to the current operator session.

```text
<STAGING_APP_REF>
<STAGING_RECOVERY_REF>
<KNOWN_PRODUCTION_REFS>
<OUTSIDE_REPO_EDGE_ENV_PATH>
```

The Edge secret file contains names only in this runbook; its actual values stay outside Git:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_OWNER_EXTERNAL_ID
TELEGRAM_CALLBACK_HMAC_KEY
INTERNAL_FUNCTION_SECRET
RECOVERY_SUPABASE_URL
RECOVERY_SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the app Edge environment. The local
runner additionally needs `STAGING_SUPABASE_ANON_KEY` and the same `INTERNAL_FUNCTION_SECRET` in its
process environment; neither belongs in Git.

## Local Readiness Before Remote Actions

From the Phase 4 worktree:

```powershell
$appRef = "<STAGING_APP_REF>"
$recoveryRef = "<STAGING_RECOVERY_REF>"
$env:TG_GAME_CONFIRMED_STAGING_APP_REF = $appRef
$env:TG_GAME_CONFIRMED_STAGING_RECOVERY_REF = $recoveryRef
$env:TG_GAME_DENIED_PROJECT_REFS = "<KNOWN_PRODUCTION_REFS>"

npm run staging:preflight -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef
npm run staging:owner-smoke -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef
```

Required result: `status=ready`, `mode=dry-run`, 18 verified migrations, and zero day/worker calls.
The dry-run command has no network or runtime-secret permission.

## Remote Actions — Provision the Two Staging Projects

1. Confirm explicit owner approval says **staging-only**.
2. Create two new Supabase projects in the dashboard:
   - app staging: `<STAGING_APP_REF>`;
   - recovery control: `<STAGING_RECOVERY_REF>`.
3. Confirm neither ref is in the denylist and the projects have no production data.
4. In the recovery project's SQL editor, apply exactly in order:
   - `recovery-control/migrations/202607130001_deletion_tombstones.sql`;
   - `recovery-control/migrations/202607150002_record_deletion_tombstone.sql`.
5. In that same recovery project, verify without selecting any rows:

```sql
select
  to_regclass('recovery.deletion_tombstones') is not null as table_ready,
  has_function_privilege(
    'service_role',
    'public.record_deletion_tombstone_v1(uuid,uuid,timestamptz)',
    'execute'
  ) as service_can_execute,
  not has_function_privilege(
    'anon',
    'public.record_deletion_tombstone_v1(uuid,uuid,timestamptz)',
    'execute'
  ) as anon_denied;
```

All three values must be `true`. Do not link the app worktree to the recovery project.

## Remote Actions — Link and Migrate App Staging

```powershell
supabase link --project-ref $appRef
npm run staging:preflight -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef
supabase db push --linked --dry-run
```

The dry run must list only the expected application migrations through
`202607150016_current_card_render_cache.sql`. A fresh project receives migrations 001–016; the final
three must be 014, then 015, then 016. Do not use `--include-seed` yet.

After manual review:

```powershell
supabase db push --linked
supabase migration list --linked
```

Stop unless local and remote histories match through 016. At this point the tutorial flag is absent
or false and the owner has not sent `/start`.

## Remote Actions — Secrets and Deployment

The operator creates `<OUTSIDE_REPO_EDGE_ENV_PATH>` outside the repository. Copy the existing bot
token there manually; do not ask Codex to read `.env`. Set `RECOVERY_SUPABASE_URL` to the exact
recovery project origin and use that project's service-role credential.

If the numeric owner Telegram ID is not already known, keep the webhook absent, send one harmless
message to the bot and inspect `getUpdates` in a private local operator session. Retain only
`message.from.id`; do not log or save the returned profile/message object. The later webhook
registration drops this queued update. Do not use a third-party identity bot for this step.

```powershell
$edgeSecretsPath = "<OUTSIDE_REPO_EDGE_ENV_PATH>"
supabase secrets set --project-ref $appRef --env-file $edgeSecretsPath

supabase functions deploy day-publish-reset outbox-worker --project-ref $appRef
supabase functions deploy tg-webhook --project-ref $appRef
```

Deployment order is mandatory: internal functions first, webhook last. Before webhook registration,
prove both internal functions reject unauthenticated requests and reject an authenticated request
that lacks `X-TgGame-Internal-Secret`. Record status codes only.

```powershell
$functionBase = "https://$appRef.supabase.co/functions/v1"
function Assert-RemoteStatus([string]$Uri, [hashtable]$Headers, [int]$Expected) {
  try {
    Invoke-WebRequest -Method Post -Uri $Uri -Headers $Headers | Out-Null
    throw "unexpected_remote_success"
  } catch {
    if ([int]$_.Exception.Response.StatusCode -ne $Expected) { throw }
  }
}

foreach ($name in @("day-publish-reset", "outbox-worker")) {
  Assert-RemoteStatus "$functionBase/$name" @{} 401
  Assert-RemoteStatus "$functionBase/$name" @{
    Authorization = "Bearer $env:STAGING_SUPABASE_ANON_KEY"
    apikey = $env:STAGING_SUPABASE_ANON_KEY
  } 401
}
```

## Remote Actions — Register Webhook and Prove Non-Owner Rejection

Use the bot token and webhook secret from the operator session. Do not enable command logging or a
PowerShell transcript. Register only `message` and `callback_query`, and discard old queued updates.

```powershell
$telegramBase = "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN"
$webhookBody = @{
  url = "$functionBase/tg-webhook"
  secret_token = $env:TELEGRAM_WEBHOOK_SECRET
  allowed_updates = @("message", "callback_query")
  drop_pending_updates = $true
} | ConvertTo-Json -Depth 4

$registration = Invoke-RestMethod -Method Post -Uri "$telegramBase/setWebhook" `
  -ContentType "application/json" -Body $webhookBody
if (-not $registration.ok) { throw "webhook_registration_failed" }
```

Before the owner sends `/start`, record this aggregate in the app SQL editor:

```sql
select count(*)::integer as telegram_identity_count
from game.identity_links where platform = 'telegram';
```

Send one authenticated synthetic update whose actor is a positive safe integer different from the
owner. This does not require a second Telegram account:

```powershell
$syntheticNonOwner = [int64]"<SYNTHETIC_NON_OWNER_ID>"
$syntheticUpdate = @{
  update_id = 700000001
  message = @{
    message_id = 1
    from = @{ id = $syntheticNonOwner; is_bot = $false; first_name = "Synthetic" }
    chat = @{ id = $syntheticNonOwner; type = "private" }
    date = 1
    text = "/start"
  }
} | ConvertTo-Json -Depth 6

try {
  Invoke-WebRequest -Method Post -Uri "$functionBase/tg-webhook" `
    -Headers @{ "X-Telegram-Bot-Api-Secret-Token" = $env:TELEGRAM_WEBHOOK_SECRET } `
    -ContentType "application/json" -Body $syntheticUpdate | Out-Null
  throw "synthetic_non_owner_was_not_rejected"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 403) { throw }
}
```

Run the count query again. It must be unchanged. Any increase is a hard stop: remove the webhook,
disable new starts and investigate before seeding or owner use.

## Remote Actions — Seed, Run and Play

Only after non-owner rejection is proven:

```powershell
supabase db push --linked --include-seed
```

Verify in the app SQL editor that the active fallback/config exists and
`tutorial_starter_enabled=true`. Then expose only the required local runner variables in the current
session and execute the explicitly remote command:

```powershell
npm run staging:preflight -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef --execute-remote
npm run staging:owner-smoke:execute -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef --execute-remote
```

The runner publishes/opens the fallback day once, then polls `outbox-worker` every two seconds until
Ctrl+C. Keep the machine awake. It prints aggregate counts only.

The owner now tests through the real private bot:

1. `/start` shows the Academy home.
2. Complete tutorial expedition 1 and resolve the guided stat choice or defer it.
3. Complete tutorial expedition 2 and accept or discard the offered item.
4. Choose one ordinary blue starter ring.
5. Open `Герой`, `Академія`, `Допомога`; verify exact build and next goal.
6. Start the third expedition and verify the chosen build changes the forecast/result.
7. Send `/resume`, press one stale callback, and verify one canonical card is restored/edited.
8. If `delivery_unknown` appears, stop the runner and follow
   [delivery-unknown-reconciliation.md](delivery-unknown-reconciliation.md).
9. Test `/privacy` and deletion only through
   [staging-deletion-recovery.md](staging-deletion-recovery.md).

Record the product evidence while playing; a technically green smoke is not enough:

- last completed stage and earned XP for each of the three expeditions;
- whether the stat/threshold/HP breakdown made the result and next decision understandable;
- whether reaching stage 6 felt earned, especially when neutral choices were used;
- whether the repeated fallback day felt monotonous by the second or third expedition;
- whether the generic teacher/lesson presentation weakened the sense of being an Academy student;
- whether the item, ring, spendable XP and next-day hook created a concrete reason to return.

Do not tune production numbers during the session. Preserve the redacted observations for the
Gate 4T.1 checkpoint and choose any content/balance amendment only after closeout.

## Closeout and Rollback

Normal closeout:

1. Ctrl+C the runner.
2. Confirm no `leased` or `delivery_unknown` owner rows remain.
3. Disable `tutorial_starter_enabled`.
4. Remove the Telegram webhook with `drop_pending_updates=true`.
5. Rotate the bot token if it may have appeared in output or if staging will not be retained.
6. Remove local session secrets and delete the outside-repository Edge env file according to the
   owner's secret-retention policy.

Rollback after a bad function build:

- stop new starts and the runner first;
- reconcile or safely supersede the single owner profile's delivery state;
- deploy the last known-good function commit or delete the staging webhook function;
- keep forward database/recovery tables and audit rows—do not downgrade or delete migrations;
- remove the webhook before investigating.

Evidence may contain commit SHA, migration versions, status codes, aggregate row counts and runner
totals. It must not contain project refs, real Telegram IDs, message text, bot token, webhook/internal
secrets, service keys or database URLs.
