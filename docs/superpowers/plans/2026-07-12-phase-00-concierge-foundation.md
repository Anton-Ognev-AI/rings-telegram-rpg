# Phase 0 Concierge and Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** створити перевірюваний локальний фундамент Deno/Supabase/grammY та готовий комплект для ручної перевірки 10-етапної Telegram-сесії, не торкаючись remote systems.

**Architecture:** Phase 0 не реалізує game mechanics. Pure ports/handlers тестуються через Deno; Supabase CLI лише створює local scaffold; Docker-dependent DB/runtime checks є окремим gate. Concierge dungeon зберігається як reviewable Markdown, а session data — лише під анонімними IDs.

**Tech Stack:** Git, Node.js 24, npm, project-local Deno CLI, project-local Supabase CLI, Deno test, Supabase Edge Function skeleton.

## Global Constraints

- Work in `D:\Projects\TgGame`; no remote Supabase, Telegram webhook, secrets or production mutation.
- Do not edit `CLAUDE.md`, approved specs, lore or research.
- Use `apply_patch` for authored files; generated CLI scaffold may be produced by its official command.
- No production code before a failing test is observed.
- Do not record Telegram usernames, real names, tokens, chat IDs or message bodies in tracked logs.
- `.git` is currently empty; initialize it in place for bootstrap. Worktree choice is deferred to the Phase 0 checkpoint.
- Docker is absent; do everything independent of Docker and report the blocked local-stack check once.

---

### Task 1: Tracking and valid Git baseline

**Files:**

- Modify: `DECISIONS.md`
- Modify: `PROJECT_STATE.md`
- Modify: `TASKS.md`
- Modify: `docs/superpowers/plans/2026-07-12-telegram-academy-mvp.md`
- Create: `.gitignore`
- Create: `.editorconfig`

**Interfaces:**

- Produces: valid Git repository on `main`; baseline commit containing approved docs only.

- [ ] **Step 1: Record ADR 034 and activate Phase 0**

Expected: plan status is approved; `TASKS.md` has exactly one active `PHASE-00`.

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
coverage/
artifacts/
.env
.env.*
!.env.example
supabase/.temp/
.worktrees/
*.log
prototypes/concierge/session-log.csv
```

- [ ] **Step 3: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.sql]
indent_size = 2
```

- [ ] **Step 4: Initialize Git and inspect identity**

Run:

```powershell
git init -b main
git config --get user.name
git config --get user.email
git status --short
```

Expected: valid repository on `main`. If identity is absent, do not invent it; postpone commits and add one checkpoint question.

- [ ] **Step 5: Commit approved documentation baseline**

Run:

```powershell
git add AGENTS.md CLAUDE.md README.md PROJECT_STATE.md TASKS.md DECISIONS.md docs .gitignore .editorconfig
git commit -m "docs: approve game spec and MVP plan"
```

Expected: one root commit; working tree contains no untracked approved docs.

---

### Task 2: Concierge test kit

**Files:**

- Create: `prototypes/concierge/dungeon-001.md`
- Create: `prototypes/concierge/session-log.template.csv`
- Create locally/ignored: `prototypes/concierge/session-log.csv`
- Create: `prototypes/concierge/README.md`

**Interfaces:**

- Produces: `ConciergeDungeonV1` represented as ten numbered scene cards with three choices and moderator-only outcomes.
- Produces: anonymous metrics schema used by the Phase 0 product gate.

- [ ] **Step 1: Write one handcrafted dungeon**

Requirements:

- exactly 10 stages;
- stage 1 non-combat and no trap;
- stage 5 one-choice mini-boss;
- stage 10 exactly two exchanges;
- each ordinary stage has physical/magical/agility/vitality check coverage across the run plus a neutral route;
- every choice has a visible clue and one-sentence post-choice explanation;
- no Max, black ring or flesh magic;
- reader-facing text stays under 700 characters per stage.

- [ ] **Step 2: Create anonymous CSV template**

```csv
participant_id,started_at_utc,first_choice_seconds,active_run_seconds,reached_stage,boss_result,clue_understood_count,needed_oral_help,message_fatigue_1_5,return_tomorrow_1_5,notes_without_pii
```

- [ ] **Step 3: Create local ignored session log from template**

Run:

```powershell
Copy-Item prototypes/concierge/session-log.template.csv prototypes/concierge/session-log.csv
```

- [ ] **Step 4: Document moderator protocol**

Protocol must state: send one card at a time; never reveal best choice; manually apply displayed HP; record active time excluding long pauses; use participant IDs `P01`…`P05`; delete free-text PII before committing.

- [ ] **Step 5: Validate the kit structurally**

Run:

```powershell
$text = Get-Content prototypes/concierge/dungeon-001.md -Raw -Encoding UTF8
([regex]::Matches($text, '(?m)^## Stage \d+')).Count
```

Expected: `10`.

- [ ] **Step 6: Commit**

```powershell
git add prototypes/concierge
git commit -m "test: add concierge dungeon kit"
```

---

### Task 3: Project-local toolchain scaffold

**Files:**

- Create: `package.json`
- Generate: `package-lock.json`
- Create: `deno.json`
- Generate: `deno.lock`
- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Produces commands: `npm run verify`, `npm run supabase`, `npx deno task verify`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "telegram-academy-game",
  "private": true,
  "version": "0.0.0",
  "description": "Telegram Academy game MVP",
  "license": "UNLICENSED",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "deno": "deno",
    "supabase": "supabase",
    "verify": "deno task verify"
  }
}
```

- [ ] **Step 2: Install stable project-local CLIs**

Run:

```powershell
npm install --save-dev deno supabase
```

Expected: exact versions written to `package-lock.json`; no global/system install.

- [ ] **Step 3: Create `deno.json`**

```json
{
  "lock": true,
  "compilerOptions": {
    "strict": true,
    "lib": ["deno.ns", "dom", "dom.iterable", "esnext"]
  },
  "fmt": {
    "lineWidth": 100,
    "indentWidth": 2,
    "semiColons": true,
    "singleQuote": false
  },
  "lint": {
    "rules": {
      "tags": ["recommended"]
    }
  },
  "tasks": {
    "check": "deno check supabase/functions/health/index.ts supabase/functions/health/handler.ts supabase/functions/_shared/infrastructure/clock.ts supabase/functions/_shared/infrastructure/telegram-port.ts supabase/functions/_shared/infrastructure/redact.ts",
    "test:unit": "deno test tests/unit",
    "verify": "deno fmt --check && deno lint && deno task check && deno task test:unit"
  }
}
```

- [ ] **Step 4: Add CI**

CI runs on Windows and executes:

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run verify
```

- [ ] **Step 5: Verify package toolchains**

Run:

```powershell
npm ci
npx deno --version
npx supabase --version
```

Expected: commands resolve from project dependencies.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json deno.json deno.lock .github/workflows/ci.yml
git commit -m "chore: add local Deno and Supabase toolchain"
```

---

### Task 4: Health handler via TDD

**Files:**

- Test: `tests/unit/health_handler_test.ts`
- Create after RED: `supabase/functions/health/handler.ts`
- Create after GREEN: `supabase/functions/health/index.ts`

**Interfaces:**

- Produces: `handleHealth(request: Request): Response`.

- [ ] **Step 1: Write failing test**

```ts
import { assertEquals } from "jsr:@std/assert";
import { handleHealth } from "../../supabase/functions/health/handler.ts";

Deno.test("health handler returns a stable service response", async () => {
  const response = handleHealth(new Request("http://localhost/health"));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "telegram-academy",
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx deno test tests/unit/health_handler_test.ts
```

Expected: FAIL because `handler.ts` does not exist.

- [ ] **Step 3: Implement minimal handler**

```ts
export function handleHealth(_request: Request): Response {
  return Response.json({
    status: "ok",
    service: "telegram-academy",
  });
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx deno test tests/unit/health_handler_test.ts
```

Expected: `1 passed`.

- [ ] **Step 5: Add Edge entrypoint**

```ts
import { handleHealth } from "./handler.ts";

Deno.serve(handleHealth);
```

- [ ] **Step 6: Check entrypoint**

Run:

```powershell
npx deno check supabase/functions/health/index.ts
```

Expected: no diagnostics.

- [ ] **Step 7: Commit**

```powershell
git add tests/unit/health_handler_test.ts supabase/functions/health
git commit -m "feat: add health edge function"
```

---

### Task 5: Fake clock, Telegram port and redaction via TDD

**Files:**

- Test: `tests/unit/infrastructure_test.ts`
- Create after RED: `supabase/functions/_shared/infrastructure/clock.ts`
- Create after RED: `supabase/functions/_shared/infrastructure/telegram-port.ts`
- Create after RED: `supabase/functions/_shared/infrastructure/redact.ts`

**Interfaces:**

- Produces: `Clock.now(): Date`.
- Produces: `FakeTelegramPort.send(input): Promise<{ messageId: string }>`.
- Produces: `redactRecord(record): Record<string, unknown>`.

- [ ] **Step 1: Write failing tests**

```ts
import { assertEquals } from "jsr:@std/assert";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import { FakeTelegramPort } from "../../supabase/functions/_shared/infrastructure/telegram-port.ts";
import { redactRecord } from "../../supabase/functions/_shared/infrastructure/redact.ts";

Deno.test("fixed clock returns a defensive Date copy", () => {
  const clock = new FixedClock("2026-07-12T09:00:00.000Z");
  const first = clock.now();
  first.setUTCFullYear(2000);
  assertEquals(clock.now().toISOString(), "2026-07-12T09:00:00.000Z");
});

Deno.test("fake Telegram port records sent messages", async () => {
  const port = new FakeTelegramPort();
  const result = await port.send({ chatId: "test-chat", text: "Вітаємо" });
  assertEquals(result, { messageId: "fake-1" });
  assertEquals(port.sent, [{ chatId: "test-chat", text: "Вітаємо" }]);
});

Deno.test("redaction removes sensitive values", () => {
  assertEquals(
    redactRecord({
      event: "callback",
      token: "secret",
      telegramActorId: "123",
      authorization: "Bearer value",
    }),
    {
      event: "callback",
      token: "[REDACTED]",
      telegramActorId: "[REDACTED]",
      authorization: "[REDACTED]",
    },
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx deno test tests/unit/infrastructure_test.ts
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 3: Implement minimal clock**

```ts
export interface Clock {
  now(): Date;
}

export class FixedClock implements Clock {
  readonly #instantMs: number;

  constructor(instant: string | Date) {
    this.#instantMs = new Date(instant).getTime();
  }

  now(): Date {
    return new Date(this.#instantMs);
  }
}
```

- [ ] **Step 4: Implement minimal Telegram port**

```ts
export interface SendMessageInput {
  chatId: string;
  text: string;
}

export interface TelegramPort {
  send(input: SendMessageInput): Promise<{ messageId: string }>;
}

export class FakeTelegramPort implements TelegramPort {
  readonly sent: SendMessageInput[] = [];

  send(input: SendMessageInput): Promise<{ messageId: string }> {
    this.sent.push({ ...input });
    return Promise.resolve({ messageId: `fake-${this.sent.length}` });
  }
}
```

- [ ] **Step 5: Implement shallow redaction**

```ts
const SENSITIVE_KEYS = new Set([
  "authorization",
  "secret",
  "telegramActorId",
  "token",
]);

export function redactRecord(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_KEYS.has(key) ? "[REDACTED]" : value,
    ]),
  );
}
```

- [ ] **Step 6: Verify GREEN and full unit suite**

Run:

```powershell
npx deno test tests/unit/infrastructure_test.ts
npx deno task test:unit
```

Expected: `4 passed` across both test files.

- [ ] **Step 7: Commit**

```powershell
git add tests/unit/infrastructure_test.ts supabase/functions/_shared/infrastructure
git commit -m "test: add deterministic Phase 0 adapters"
```

---

### Task 6: Supabase local scaffold and documentation

**Files:**

- Generate: `supabase/config.toml`
- Create: `supabase/seed.sql`
- Create: `docs/runbooks/local-development.md`
- Modify: `README.md`

**Interfaces:**

- Produces documented local commands and operational defaults.

- [ ] **Step 1: Initialize Supabase**

Run:

```powershell
npx supabase init
```

Expected: `supabase/config.toml` created; no remote project linked.

- [ ] **Step 2: Create empty idempotent seed**

```sql
-- Phase 0 has no schema or seed data.
select 1;
```

- [ ] **Step 3: Write local-development runbook**

Include:

- prerequisites and exact versions from `node --version`, `npx deno --version`, `npx supabase --version`;
- `npm ci`, `npm run verify`, `npx supabase start`, `npx supabase stop`;
- localhost-only warning;
- no secrets in repo;
- severity P0/P1;
- expected alpha peak 1 callback/s and gate 10 callbacks/s for 10 minutes;
- RTO ≤4 hours, disaster RPO ≤24 hours for closed alpha;
- immediate identity unlink and deletion completion ≤24 hours.

- [ ] **Step 4: Replace template README with project README**

README links canonical spec, master-plan, Phase 0 plan, local runbook and states that runtime LLM is forbidden.

- [ ] **Step 5: Attempt Docker-dependent local gate once**

Run:

```powershell
npx supabase start
```

Expected in current environment: blocked because no Docker-compatible runtime. Record this once in checkpoint; do not retry until Docker/Podman is installed.

- [ ] **Step 6: Commit Docker-independent scaffold**

```powershell
git add supabase README.md docs/runbooks/local-development.md
git commit -m "docs: add local Supabase development scaffold"
```

---

### Task 7: Phase 0 verification and checkpoint

**Files:**

- Modify: `TASKS.md`
- Modify: `PROJECT_STATE.md`
- Create: `docs/checkpoints/2026-07-12-phase-00.md`

**Interfaces:**

- Produces: evidence table with PASS/BLOCKED/EXTERNAL states and one batched question list.

- [ ] **Step 1: Run Docker-independent verification**

```powershell
npm ci
npm run verify
npx supabase --version
git status --short
```

Expected: format/lint/check/unit tests pass; only intentional checkpoint/status edits remain.

- [ ] **Step 2: Run document checks**

Verify:

- concierge has exactly 10 stages;
- CSV template has no participant data;
- approved spec/master-plan hashes or sizes are unchanged;
- no `.env`, token, chat ID or session log is tracked.

- [ ] **Step 3: Classify Phase 0 gate**

- `PASS`: Git/toolchain/tests/docs.
- `BLOCKED_EXTERNAL`: Docker local stack.
- `PENDING_HUMAN`: 3–5 concierge sessions.
- `PENDING_DECISION`: worktree preference before Phase 1.

- [ ] **Step 4: Write one checkpoint report**

Questions are batched:

1. allow per-user Docker Desktop/compatible runtime installation;
2. choose isolated worktree or current workspace for Phase 1;
3. identify or authorize 3–5 concierge testers.

- [ ] **Step 5: Update project memory**

Do not mark `PHASE-00` approved until all mandatory Phase 0 gates are satisfied. Mark independently completed subtasks and name the next safe step.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add PROJECT_STATE.md TASKS.md docs/checkpoints/2026-07-12-phase-00.md docs/superpowers/plans/2026-07-12-phase-00-concierge-foundation.md
git commit -m "docs: record Phase 0 checkpoint"
```

