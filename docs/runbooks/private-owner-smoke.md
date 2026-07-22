# Private Telegram Owner-Smoke Runbook

**Scope:** one owner, one private bot, one isolated app staging project, one isolated
recovery-control staging project and one disposable restore target used only for the deletion drill.

**Current gate:** documentation only. Do not execute any command in the `Remote actions` sections
until the owner explicitly authorizes staging-only Supabase and Telegram use.

## Safety Rules

- Never paste a bot token, service key, webhook secret, owner Telegram ID or database password into
  chat, Git, command output or the checkpoint.
- Do not read or print `.env`. The owner's local `.env` is not automatically consumed by Supabase
  deploy or by the smoke runner.
- Keep app and recovery project refs different. Put known production refs in
  `TG_GAME_DENIED_PROJECT_REFS` with commas and no spaces.
- Keep the disposable restore target different from both staging projects, denylist it from normal
  bot use, never deploy the webhook there and destroy it after the drill.
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
<RESTORE_DRILL_REF>
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

Creating or filling this outside-repository file does **not** install the values in Supabase. The
owner must also complete the later `supabase secrets set --env-file ...` command against app
staging and verify `7/7` required names before reporting the secret-storage checkpoint complete.
Never point `secrets set` at recovery staging, and never use the general project `.env` as the
Edge env file because it may contain unrelated variables.

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

Required result: `status=ready`, `mode=dry-run`, 19 verified migrations, and zero day/worker calls.
The dry-run command has no network or runtime-secret permission.

## Remote Actions — Provision the Two Staging Projects

1. Confirm explicit owner approval says **staging-only**.
2. Create two new Supabase projects in the dashboard:
   - app staging: `<STAGING_APP_REF>`;
   - recovery control: `<STAGING_RECOVERY_REF>`.
3. Confirm the approved staging scope also permits a disposable `<RESTORE_DRILL_REF>`. Create it
   only immediately before the deletion drill; it is not a third persistent game service.
4. Confirm none of the refs identifies production and all three targets contain no production data.
5. In the recovery project's SQL editor, apply exactly in order:
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

Because dashboard SQL execution does not populate Supabase CLI migration history, align the
recovery ledger before continuing. Use an isolated temporary workdir containing only the two exact
checksum-pinned recovery migrations. First prove a linked dry run sees the history mismatch; after
the schema/grant query above and a schema-only comparison both pass, run:

```powershell
supabase migration repair 202607130001 202607150002 --status applied
supabase migration list --linked
supabase db push --linked --dry-run
```

Required: remote history is exactly 001–002 and the final dry run has zero pending migrations. Do
not use the app worktree or reapply schema SQL merely because the ledger was initially empty.

## Remote Actions — Link and Migrate App Staging

```powershell
supabase link --project-ref $appRef
npm run staging:preflight -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef
supabase db push --linked --dry-run
```

The dry run must list only the expected application migrations through
`202607190017_tutorial_field_discovery.sql`. A fresh project receives migrations 001–017; the final
four must be 014, then 015, then 016, then 017. Do not use `--include-seed` yet.

After manual review:

```powershell
supabase db push --linked
supabase migration list --linked
```

Stop unless local and remote histories match through 017. At this point the tutorial flag is absent
or false and the owner has not sent `/start`.

## Remote Actions — Secrets and Deployment

The owner/operator—not Codex—creates `<OUTSIDE_REPO_EDGE_ENV_PATH>` outside the repository and runs
the secret-storage step. Copy the existing bot token there manually; do not ask Codex to read
`.env`. Set `RECOVERY_SUPABASE_URL` to the exact recovery project origin and use that project's
service-role credential. Codex may continue only after the operator reports that secret storage
completed; it must never inspect the file or echo the command environment.

If the numeric owner Telegram ID is not already known, keep the webhook absent, send one harmless
message to the bot and inspect `getUpdates` in a private local operator session. Retain only
`message.from.id`; do not log or save the returned profile/message object. The later webhook
registration drops this queued update. Do not use a third-party identity bot for this step.

```powershell
$edgeSecretsPath = "<OUTSIDE_REPO_EDGE_ENV_PATH>"
supabase secrets set --project-ref $appRef --env-file $edgeSecretsPath

if ($LASTEXITCODE -ne 0) { throw "edge_secret_storage_failed" }

$secretResponse = supabase secrets list --project-ref $appRef `
  --output-format json --log-level error | ConvertFrom-Json

# Current CLI releases wrap rows in `secrets`; retain array compatibility for older releases.
# Check the root property explicitly: PowerShell's array property projection can otherwise make
# `$secretResponse.secrets` look present for an unwrapped legacy array.
$hasSecretsWrapper = @($secretResponse.PSObject.Properties.Name) -contains "secrets"
$secretRows = if ($hasSecretsWrapper) {
  @($secretResponse.secrets)
} else {
  @($secretResponse)
}
$secretNames = @($secretRows | ForEach-Object { $_.name } | Where-Object { $_ })
$requiredSecretNames = @(
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_OWNER_EXTERNAL_ID",
  "TELEGRAM_CALLBACK_HMAC_KEY",
  "INTERNAL_FUNCTION_SECRET",
  "RECOVERY_SUPABASE_URL",
  "RECOVERY_SUPABASE_SERVICE_ROLE_KEY"
)
$missingSecretNames = @($requiredSecretNames | Where-Object { $_ -notin $secretNames })
if ($missingSecretNames.Count -ne 0) {
  throw "edge_secret_names_missing: $($missingSecretNames -join ',')"
}
Write-Host "status=ready required_edge_secrets=7/7"

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

Before the owner sends `/start`, record this aggregate in the app SQL editor:

```sql
select count(*)::integer as telegram_identity_count
from game.identity_links where platform = 'telegram';
```

The owner/operator then runs the following block in a private PowerShell session with transcripts
disabled. It reads only the three required Telegram values from the outside-repository Edge file,
registers only `message` and `callback_query`, drops queued updates, verifies the registered URL and
sends one authenticated synthetic non-owner update. The synthetic actor is derived locally to be
different from the owner and does not require a second Telegram account. No secret or project ref is
printed. If the block fails, close that terminal before sharing only the generic error identifier.

```powershell
$edgeSecretsPath = "<OUTSIDE_REPO_EDGE_ENV_PATH>"
$operatorSecrets = @{}

try {
  if (-not (Test-Path -LiteralPath $edgeSecretsPath)) {
    throw "edge_staging_env_not_found"
  }

  foreach ($line in Get-Content -LiteralPath $edgeSecretsPath) {
    if ($line -match `
      '^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_OWNER_EXTERNAL_ID)\s*=(.*)$'
    ) {
      $name = $Matches[1]
      $value = $Matches[2].Trim()
      if ([string]::IsNullOrWhiteSpace($value)) { throw "empty_operator_secret:$name" }
      if ($operatorSecrets.ContainsKey($name)) { throw "duplicate_operator_secret:$name" }
      $operatorSecrets[$name] = $value
    }
  }

  $required = @(
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_OWNER_EXTERNAL_ID"
  )
  $missing = @($required | Where-Object { -not $operatorSecrets.ContainsKey($_) })
  if ($missing.Count -ne 0) { throw "missing_operator_secrets:$($missing -join ',')" }

  [long]$ownerId = 0
  if (-not [long]::TryParse(
    $operatorSecrets["TELEGRAM_OWNER_EXTERNAL_ID"],
    [ref]$ownerId
  ) -or $ownerId -le 0) {
    throw "invalid_owner_id"
  }

  $telegramBase = "https://api.telegram.org/bot$($operatorSecrets['TELEGRAM_BOT_TOKEN'])"
  $webhookBody = @{
    url = "$functionBase/tg-webhook"
    secret_token = $operatorSecrets["TELEGRAM_WEBHOOK_SECRET"]
    allowed_updates = @("message", "callback_query")
    drop_pending_updates = $true
  } | ConvertTo-Json -Depth 4

  try {
    $registration = Invoke-RestMethod -Method Post -Uri "$telegramBase/setWebhook" `
      -ContentType "application/json" -Body $webhookBody -ErrorAction Stop
  } catch {
    throw "telegram_set_webhook_request_failed"
  }
  if (-not $registration.ok) { throw "telegram_webhook_registration_failed" }

  try {
    $webhookInfo = Invoke-RestMethod -Method Get -Uri "$telegramBase/getWebhookInfo" `
      -ErrorAction Stop
  } catch {
    throw "telegram_webhook_info_failed"
  }
  if (-not $webhookInfo.ok -or $webhookInfo.result.url -ne "$functionBase/tg-webhook") {
    throw "telegram_webhook_verification_failed"
  }
  $allowedUpdates = @($webhookInfo.result.allowed_updates)
  if (
    $allowedUpdates.Count -ne 2 -or
    "message" -notin $allowedUpdates -or
    "callback_query" -notin $allowedUpdates
  ) {
    throw "telegram_allowed_updates_mismatch"
  }

  [long]$syntheticNonOwner = if ($ownerId -ne 900000001) { 900000001 } else { 900000002 }
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
    $response = Invoke-WebRequest -UseBasicParsing -Method Post `
      -Uri "$functionBase/tg-webhook" `
      -Headers @{
        "X-Telegram-Bot-Api-Secret-Token" = $operatorSecrets["TELEGRAM_WEBHOOK_SECRET"]
      } `
      -ContentType "application/json" -Body $syntheticUpdate -ErrorAction Stop
    $nonOwnerStatus = [int]$response.StatusCode
  } catch {
    if ($null -eq $_.Exception.Response) { throw "synthetic_non_owner_request_failed" }
    $nonOwnerStatus = [int]$_.Exception.Response.StatusCode
  }
  if ($nonOwnerStatus -ne 403) {
    throw "synthetic_non_owner_expected_403_got_$nonOwnerStatus"
  }

  Write-Host "status=ready webhook_registered=true synthetic_non_owner=403"
} finally {
  $operatorSecrets.Clear()
  Remove-Variable -Name @(
    "operatorSecrets",
    "telegramBase",
    "webhookBody",
    "registration",
    "webhookInfo",
    "syntheticUpdate",
    "ownerId",
    "syntheticNonOwner",
    "nonOwnerStatus",
    "allowedUpdates",
    "response",
    "line",
    "value",
    "Matches"
  ) -ErrorAction SilentlyContinue
}
```

Run the count query again. It must be unchanged. Any increase is a hard stop: remove the webhook,
disable new starts and investigate before seeding or owner use.

## Remote Actions — Seed, Run and Play

Only after non-owner rejection is proven:

```powershell
supabase db push --linked --include-seed
```

The reviewed fallback JSON is UTF-8 without a BOM. Windows PowerShell 5.1 must never read it with
plain `Get-Content`: its default code page can silently turn Ukrainian text into mojibake while a
separately computed SHA still looks valid. Any operator-side inspection must be explicit:

```powershell
$fallback = Get-Content -LiteralPath "content/fallback/case-001/day-01.json" `
  -Raw -Encoding UTF8 | ConvertFrom-Json
```

Do not construct an ad hoc Management API insert from that PowerShell object. Content import must
go through `buildContentSeedRecord` in `scripts/db/seed-content.ts`, which validates the schema,
rejects suspicious Cyrillic mojibake and computes the canonical hash from the same decoded payload.
Never combine a payload loaded by one path with a hash computed by another.

After any staging content import, inspect the stored payload itself rather than trusting only the
declared `payload_sha256`:

```sql
select
  cv.payload_sha256,
  cv.payload->'stages'->0->>'scene' as first_scene,
  (
    select jsonb_agg(choice->>'label' order by ordinality)
    from jsonb_array_elements(cv.payload->'stages'->0->'choices')
      with ordinality as c(choice, ordinality)
  ) as first_choices
from game.fallback_content fallback
join game.content_versions cv on cv.id = fallback.content_version_id
where fallback.slot = 'daily-v1';
```

The hash must be
`9000f0cebc29e6483b80de0bf8cf09c6f926821d317c17890654bc343fbb1c81`; the scene and all
three labels must be readable Ukrainian. Any `Р...`/`С...` sequences are a hard stop before the
owner begins or resumes an expedition.

Verify in the app SQL editor that the active fallback/config exists and
`tutorial_starter_enabled=true`. Then expose only the required local runner variables in the current
session and execute the explicitly remote command:

```powershell
npm run staging:preflight -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef --execute-remote
npm run staging:owner-smoke:execute -- --staging --project-ref $appRef --recovery-project-ref $recoveryRef --execute-remote
```

The runner publishes/opens the fallback day once, then polls `outbox-worker` every two seconds until
Ctrl+C. Keep the machine awake. It prints aggregate counts only. Confirm the newly launched process
is still alive before telling the owner to play; a runner from an earlier operator session must be
treated as stopped until re-verified.

This is intentionally a three-cycle smoke, not three runs in one sitting. The database permits one
run per player per Kyiv cycle, and the production-shaped webhook uses the real clock. Do not change
the machine clock, edit timestamps or add a staging time override. At each new cycle (after the
09:00 `Europe/Kyiv` boundary), start the remote runner command again so it publishes/opens that
cycle once. Stop the runner when the current play session and outbox drain are complete; the
owner-only webhook may remain registered between cycles.

The owner now tests through the real private bot in this order:

1. **Cycle 1:** `/start` shows the Academy home; complete tutorial expedition 1 and resolve the
   guided stat choice or defer it.
2. **Cycle 2:** restart the runner, complete tutorial expedition 2, accept or discard the offered
   item, and choose one ordinary blue starter ring.
3. Still in cycle 2, open `Герой`, `Академія`, `Допомога`; verify exact build and next goal.
4. **Cycle 3:** restart the runner, start the first post-tutorial expedition and verify the chosen
   build changes the forecast/result.
5. Send `/resume`, press one stale callback, and verify one canonical card is restored/edited.
6. If `delivery_unknown` appears, stop the runner and follow
   [delivery-unknown-reconciliation.md](delivery-unknown-reconciliation.md).
7. Test `/privacy` and deletion only through
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
