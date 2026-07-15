# Phase 4 Onboarding, Starter Build and Private Owner-Smoke Design

**Status:** draft for written owner review

**Date:** 2026-07-15

**Depends on:** Phase 3 approved and fast-forwarded into `main` at `b7dc200`

**Owner direction:** implement first, then validate through Telegram when feasible (ADR 046)

## 1. Decision Summary

Phase 4 is split into two sequential deliverables:

1. **Phase 4A — local onboarding and starter build.** Two actually played tutorial runs,
   teacher assistance, one guided stat purchase, one tutorial item, one starter ring, a canonical
   build snapshot and useful progressive menus. It is not complete until implemented and fully
   verified locally.
2. **Phase 4T — private Telegram owner-smoke.** A separate staging Supabase application, separate
   staging recovery store and a separate private bot restricted to the owner. It starts only after
   Phase 4A passes and after a separate remote approval for project creation/linking, migrations,
   secrets, function deployment and webhook registration.

The external 5–10-person core-loop validation remains deferred, not passed or cancelled. It starts
only after Phase 4T proves that the owner can finish the early progression loop through Telegram.

Parallel Track G, LLM generation, image generation, partnerships, random drops, ranks above Новак,
reminders, cron and public access are outside Phase 4.

## 2. Why This Preserves the Product Goal

Phase 3 proved a reliable ten-stage Telegram-shaped run, but it cannot yet test the main retention
promise. Phase 4A adds the first complete return loop:

```text
play tutorial 1
  → understand clue/stat/HP
  → receive enough XP for one stat point
  → choose a visible improvement
  → return for tutorial 2
  → resolve an item without inventory
  → choose a first blue ring and compatible main item
  → see exactly what the third run will use
```

The player is not promised that every button is predictable. Mechanical resolution stays
deterministic and explainable, while narrative copy may produce surprising consequences. Phase 4
does not add runtime RNG or let an LLM decide mechanics.

Tutorial presentation uses lesson context to reduce the three-button rhythm:

| Encounter type | Lesson heading |
|---|---|
| exploration | Урок спостереження |
| puzzle | Урок магічного аналізу |
| combat | Бойова практика |
| social | Дисципліна уваги |
| mini-boss / boss | Тактика загроз |

The current lore digest verifies the Academy but does not verify canonical teacher names. Phase 4
therefore uses the role **«Черговий наставник Академії»** and does not invent a named book
character. Named teachers can replace this role only after a source-backed lore pass.

## 3. Locked Invariants

- Migrations `001–013`, their existing checksum entries, resolver `v1`, config `v1`, content schema,
  fallback content and golden replays are never edited.
- All Phase 4 schema work is expand-only, beginning with
  `202607150014_tutorial_starter.sql`.
- Direct Edge DML into private `game` tables remains forbidden. Every read or mutation uses a
  narrow service-only RPC.
- Active runs use immutable self/loadout snapshots. Stat, item and ring changes never rewrite an
  active run.
- Telegram mutation buttons use opaque, actor-bound tokens no longer than 64 bytes.
- Duplicate or concurrent callbacks produce one effect, one XP ledger delta and one canonical
  profile version.
- No inventory is introduced. Each equipment slot contains zero or one current item.
- Black, flesh and other forbidden/reserved rings never enter a player catalog or offer.
- No secrets, Telegram identifiers, usernames or message text enter the repository, analytics or
  outbox payloads.

## 4. Phase 4A Player Flow

### 4.1 First Entry

`/start` creates or resumes a profile through `telegram_identity_v2`. The first card contains a
short Academy premise and one primary action. The first meaningful choice stays within two messages
and two taps.

During tutorial the useful menu is:

```text
[ ⚔️ Навчання ]
[ ℹ️ Допомога  ]
```

`Допомога` explains clues, stats, HP and privacy; `/privacy` and `/delete_me` remain available.

### 4.2 Tutorial Run 1

- A server-derived run snapshot uses `partyMode = tutorial` and the pinned teacher companion.
- Progression config `progression-v1` pins the teacher companion to `maxHp = 5`, `physical = 4`,
  `magical = 4`, `agility = 4`, `defense = 2`. With the initial player build and the existing
  recommended-choice simulation, this reaches stage 6, ends defeated with `43 XP` and therefore
  satisfies the intended stage-5 learning boundary without changing resolver `v1`.
- Lesson headings identify what each encounter is teaching.
- Guidance is contextual: a rule is explained at first use, not in a long pre-run manual.
- Random item and ring offers are disabled.
- One rescue is available only in tutorial run 1. If a prepared first- or second-choice resolution
  would reduce HP to zero, the teacher intervention changes that one resolution to nonterminal and
  restores group HP to `max(1, ceil(maxHp × 0.5))`. With the pinned v1 damage table this guarantees
  that the third meaningful choice is reached even after the worst legal next-stage failure.
- The rescue is a deterministic, explicit tutorial adapter around resolver `v1`; it does not alter
  resolver `v1` or its golden result.
- The adapted resolution records `tutorial.teacherRescue = true` and `tutorial.teacherRestore`, so
  HP arithmetic does not mislabel the intervention as ring or item healing. The result card explains
  it. The database accepts the adapter only for the assigned first tutorial run, while rescue is
  unused and fewer than two earlier results exist.

Tutorial run 1 is credited once when it reaches a natural terminal or HP reaches zero. Expiry is
credited only with at least three persisted stage/exchange results. Start-only and explicit abandon
never count.

When run 1 is credited, an idempotent cap-subject Academy training grant requests `20 XP`. It cannot
raise cycle earnings above the existing `150 XP` cap, but guarantees that even a low-reward valid
run leaves enough balance for the first stat point.

The summary offers a guided purchase. The player chooses one of the four base stats or explicitly
defers. Deferral does not erase XP and does not block the next day.

### 4.3 First Stat Purchase

For each stat, with `n` previously purchased points:

```text
next_point_cost = 20 + 6n + 2n²
```

The Phase 4 effects are:

| Purchase | Persistent change |
|---|---|
| Фізична сила | `physical + 1` |
| Магічна сила | `magical + 1` |
| Спритність | `agility + 1` |
| Живучість | `vitality + 1`, `maxHp + 4`; each third purchased vitality point also gives `defense + 1` |

The card shows old value, new value, exact price, remaining XP and a forecast such as
`«У наступній експедиції: Фізична сила 5 → 6»`. It never claims that one point changes a particular
fixed encounter unless the current threshold comparison proves that.

The purchase atomically locks the profile and XP account, verifies the price and 30-point MVP cap,
applies a negative cap-exempt ledger delta, increments the stat purchase counter and profile version,
and returns a cached result on replay.

### 4.4 Tutorial Run 2

- The teacher still occupies the companion slot, but guidance level is `light`.
- Only the first new concept and the first combat explain the rule before outcome; other cards rely
  on clue text and post-choice explanation.
- The run uses the stat purchase if it happened before start because a new immutable snapshot is
  created. A purchase made after start cannot change the run.
- The same completion rules apply, except no rescue is available.

When run 2 is credited, the database atomically creates exactly two ordered onboarding decisions:

1. one tutorial item offer;
2. one starter ring choice, visible only after the item is accepted or discarded.

These decisions exist even after an early HP-zero terminal. They do not exist after start-only or
explicit abandon.

### 4.5 Tutorial Item Without Inventory

The deterministic smart-loot rule produces one ordinary item:

- if the first purchased stat was Живучість: **Талісман учня**, `maxHp + 4`;
- otherwise, including a deferred purchase: **Навчальний обладунок**, `defense + 2`.

The player sees the exact slot and changed values, then chooses:

- **Вдягнути** — replace the current item in that slot;
- **Відмовитися** — discard it permanently.

No item compensation is granted for this mandatory teaching offer. The choice is idempotent and
cannot be deferred beyond the onboarding flow.

### 4.6 Starter Ring and Compatible Main Item

After the item decision, the player must choose one ordinary blue ring. Vampirism is absent.

| Ring | Technique | Phase 4 effect | Requirement |
|---|---|---|---|
| Кільце зброї | Точний удар | `floor(physicalFlat × 1.15)` | physical weapon |
| Кільце вогню | Вогняний імпульс | `floor(magicalFlat × 1.15)` | magical focus |
| Кільце захисту | Стабільний бар’єр | `floor(defenseFlat × 1.15)` | independent |
| Кільце лікування | Відновлення | `postHeal + 1` after nonlethal resolution | independent |

All four use the same ordinary rarity and blue catalog budget. Phase 4 balance tests must prove that
none strictly dominates all others across correct-route, mixed-route and attrition-heavy policies.

The Academy fills the empty main slot after ring selection:

- weapon ring → **Навчальний меч**, `physical + 2`;
- fire ring → **Учнівський жезл**, `magical + 2`;
- defense/healing ring → weapon or focus matching the higher current physical/magical value; a tie
  chooses the weapon.

The ring and main item become persistent immediately but affect combat only in a later run snapshot.
The third run is the first full application of the starter build.

The ring stores `investedXp = 0`, blue budget `2000`, rarity `ordinary` and progression policy
version. Phase 4 exposes a `20 XP → +1% blue mastery` action after onboarding. Mastery changes are
visible immediately but never alter a pinned active run; blue combat bonus remains 15% until a
future breakthrough. Breakthrough and replacement are Phase 5 concerns.

### 4.7 Tutorial Completion and Menu

After the ring choice, tutorial progress becomes `2/2`, Academy rank becomes `Новак`, profile version
increments and the full useful Phase 4 menu appears:

```text
[ ⚔️ Експедиція ] [ 🧙 Герой    ]
[ 🏛 Академія    ] [ ℹ️ Допомога ]
```

- `Герой` shows base/purchased/equipment/ring contributions, effective values, free XP and mastery.
- `Академія` shows Новак, tutorial completion and the next honest goal: a personal stage-5 check.
- `Допомога` contains gameplay rules, privacy and deletion controls.
- `Напарник` is not shown as a locked tab. Phase 6 replaces/rearranges the fourth button only when
  invitation and partnership are functional.

## 5. Canonical Router and State Machine

`/start`, `/expedition`, `/resume` and menu navigation read canonical database state. Priority is:

1. pending tutorial item;
2. pending starter ring;
3. active run;
4. tutorial run ready for the current cycle;
5. ordinary run ready for the current cycle;
6. last terminal summary;
7. menu.

The guided stat purchase is prominently offered after run 1 but is not blocking. All other pending
onboarding decisions are blocking.

Allowed onboarding transitions are:

```text
0/2 --credited run 1--> 1/2
1/2 --credited run 2--> 2/2 + pending item
pending item --accept/discard--> pending starter ring
pending starter ring --choose one--> completed + rank Новак
```

Every transition is keyed by source run or opaque action token. Replaying it returns the original
result. No path decrements tutorial progress.

## 6. Persistence Design

Migration `014` adds private normalized structures:

| Structure | Responsibility |
|---|---|
| `progression_config_versions` | Immutable versioned tutorial, item, ring and stat constants |
| `player_onboarding` | `tutorial_completed`, `profile_version`, rank and decision flags |
| `player_stat_progression` | Purchased point counters per base stat |
| `tutorial_run_assignments` | Run ordinal, guidance, teacher snapshot, rescue and credit evidence |
| `player_equipment` | At most one current item per player and slot; no inventory |
| `player_rings` | Current starter ring instance, color, rarity, mastery and policy version |
| `player_offers` | Ordered tutorial item/ring decisions and source run |
| `player_action_tokens` | Opaque profile action binding and expiry |
| `processed_player_actions` | Immutable idempotent action results |

All tables enable RLS and revoke direct access from `public`, `anon`, `authenticated` and
`service_role`. Only explicitly granted public RPCs are executable by `service_role`.

`progression-v1` contains the exact constants in sections 4.2–4.6: stat formula and cap, vitality
HP/defense steps, `20 XP` tutorial grant, both item effects, all four ring effects, blue budget,
teacher snapshot and rescue ratio. Its payload and SHA-256 are immutable after activation. The
existing feature-flag catalog gains `tutorial_starter_enabled`; it is enabled only in local Phase 4
fixtures and remains disabled at the start of any later remote migration.

New or versioned service RPCs are:

- `telegram_identity_v2(external_id, create_if_missing)`;
- `player_home_v1(player_id)`;
- `start_run_v3(player_id, at)` — derives self/loadout and group max HP server-side;
- `run_view_v2(player_id, run_id)` — adds tutorial and pending-decision metadata;
- `prepare_action_v2(...)` — validates an optional teacher-rescue adapter;
- `resolve_choice_v2(...)` — globally locks Telegram update ID, calls the locked v1 mutation and
  credits a terminal tutorial exactly once;
- `advance_day_v2(at)` — calls v1 lifecycle, then credits eligible expired tutorial runs;
- `prepare_player_action_v1(...)` and `resolve_player_action_v1(...)`;
- `request_run_render_v2(player_id, run_id)` — coalesces by run/state and returns cached when the
  canonical card is already at that state.

`resolve_choice_v2` and `resolve_player_action_v1` take the same transaction-scoped advisory lock
derived from Telegram `update_id`, then check both old and new processed-action stores. This prevents
one update from being used concurrently across run and profile action namespaces. Existing callback
tokens remain compatible because v2 wraps the locked v1 resolver.

`start_run_v3` does not trust a client-provided build. An internal projection derives:

1. persistent base and purchased stats;
2. current equipment flat bonuses;
3. current ring specialization multiplier/support effect;
4. tutorial teacher snapshot when progress is below `2/2`;
5. group max HP and the immutable self/loadout hashes.

The progression config ID is pinned inside the loadout snapshot. Later config changes cannot rewrite
an active run.

## 7. Telegram/Application Boundaries

The existing `telegram/handler.ts` remains the top-level dispatcher and does not absorb Phase 4
business logic. New behavior lives in focused modules:

- application commands for identity v2, home, canonical start, profile actions and v2 choice;
- pure tutorial adapter and build projection types;
- renderers for tutorial guidance, hero, item/ring offer, Academy and help;
- a progression callback token module using a distinct opaque prefix.

Read-only navigation may send a compact card directly, matching Phase 3 menu/privacy behavior.
Stateful tutorial actions originate from the existing canonical run message and edit that exact
message ID. Edit retries are idempotent and cannot create duplicate reward cards. If the expected
message ID does not match the callback message ID, the mutation is rejected with zero writes and the
canonical router is offered.

## 8. Error and Recovery Behavior

- Insufficient XP, stale profile version, wrong actor/message, expired token or invalid option returns
  a safe rejection with zero writes.
- A cached callback returns the byte-equivalent stored result and re-renders canonical state.
- Competing legal stat/ring/item actions produce one applied result and the rest stale/cached.
- If an edit fails retryably, Telegram redelivery repeats the same action and edits the same message.
- Identity deletion pending blocks profile reads, run starts and all progression mutations.
- Explicit abandon never grants tutorial credit or creates offers.
- A missing/invalid progression config fails closed; it never falls back to arbitrary defaults.
- Existing `delivery_unknown` new-send policy is unchanged in Phase 4A.

## 9. Phase 4A Verification Gates

### Gate 4.1 — Schema and atomicity

- clean reset and upgrade from migration `013` both pass;
- old migration hashes and locked source hashes are unchanged;
- pgTAP proves deny-by-default access, constraints, one item per slot, one starter ring, ordered
  offers, valid transitions and service-only grants;
- 100 duplicate profile callbacks produce one ledger delta and one profile-version increment;
- competing stat/item/ring actions produce exactly one legal result;
- the same Telegram update cannot mutate both run and profile namespaces;
- reconciliation remains `0/0/0`.

### Gate 4.2 — Domain and rendering

- build projection tests cover all four stat purchases, both tutorial items and all four rings;
- rescue triggers only once, only before the third resolved choice and never after tutorial run 1;
- lesson headings and guidance levels are encounter-specific;
- every Phase 4 card stays within Telegram text/callback limits and escapes HTML;
- hero breakdown shows the exact sum/multiplier source of each effective value;
- post-tutorial menu has four useful actions and no fake partner tab.

### Gate 4.3 — E2E and balance

- two published cycles complete tutorial `0/2 → 1/2 → 2/2`;
- start-only, abandon and expiry with fewer than three results do not count;
- HP-zero and eligible expiry do count exactly once;
- run 1 offers and can complete a stat purchase;
- run 2 creates item then ring after every valid terminal;
- accept and discard item paths both reach ring choice;
- each starter ring creates the correct compatible main item;
- the third run snapshot contains the selected stat/item/ring and earlier run snapshots remain
  byte-identical;
- balance simulation compares all four starter rings across correct, mixed and attrition policies;
- the Phase 4 verifier runs every Phase 3 source, database, concurrency, deletion, Telegram E2E,
  lifecycle, fault and load regression group; the historical Phase 3 verifier and its fixed
  `283 pgTAP` label remain untouched;
- no remote project, Telegram API or real identity is touched.

## 10. Phase 4T — Private Telegram Owner-Smoke

Phase 4T is a deployment preparation and owner-only validation gate, not public alpha.

### 10.1 Topology

- one separate staging Supabase app project;
- one separate staging recovery-control project;
- one separate private Telegram bot;
- one owner Telegram user ID allowlisted in an Edge secret before identity bootstrap;
- public `tg-webhook` verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` before parsing;
- internal worker/day functions retain JWT plus the separate internal secret boundary;
- secrets are provisioned with Supabase secret storage and never written to repository files or chat.

Official platform assumptions are limited to documented behavior: Supabase deploys individual Edge
Functions with the CLI and stores function secrets as environment variables; Telegram `setWebhook`
can attach a 1–256-character secret delivered in the
`X-Telegram-Bot-Api-Secret-Token` header.

### 10.2 No-Cron Smoke Runner

Phase 4T does not install cron. A local owner-smoke runner, started explicitly for a session:

1. checks an exact allowlisted staging project ref;
2. publishes/opens the fallback day once through the internal endpoint;
3. invokes the remote outbox worker every two seconds while the session is active;
4. prints redacted counts/status only;
5. stops on Ctrl+C without changing the published day;
6. refuses production-like project refs and refuses to run without an explicit `--staging` flag.

This gives responsive Telegram play without prematurely installing scheduling infrastructure. The
machine running the smoke runner must remain on during the test.

### 10.3 Pre-Remote Corrections

Before webhook registration, a separate forward migration `015` and runbook must provide:

- `request_run_render_v2` deployment and duplicate-repair coalescing so cached callbacks do not
  generate one edit per replay;
- an operator-only `delivery_unknown` reconciliation command with two explicit decisions:
  `confirm_delivered(message_id)` or `confirm_not_delivered_and_requeue`; no automatic blind retry;
- staging deletion sink provisioning and isolated backup restore + tombstone replay smoke;
- owner allowlist rejection before creating any identity;
- deploy preflight that checks project ref, migration order/checksums, feature flags and absence of
  real secrets in Git.

### 10.4 Remote Approval Gate

One explicit owner approval is required immediately before any of these actions:

- create or link the two staging projects;
- create/use the private bot or provision its token;
- apply remote migration `014` or `015`;
- set remote secrets;
- deploy Edge Functions;
- register or change the Telegram webhook.

The token and secret values are entered through local CLI/dashboard secret input, never pasted into
the conversation.

### 10.5 Owner-Smoke Acceptance

- a non-owner update is rejected before identity creation;
- owner completes `/start → tutorial 1 → stat purchase → tutorial 2 → item → ring` through Telegram;
- restart/resume and one stale callback recover canonical state;
- worker retry and one controlled `delivery_unknown` drill follow the runbook without duplicate
  rewards or cards;
- `/privacy` is visible and `/delete_me` completes through the staging recovery sink;
- isolated restore + tombstone replay does not restore the Telegram identity;
- ledger, tutorial, offers and outbox reconciliation end at zero mismatch;
- webhook is removed or bot token rotated when the private smoke window closes, unless the owner
  explicitly keeps staging active.

Only after this gate may the deferred 5–10-person core-loop validation be scheduled.

## 11. Allowed and Forbidden File Scope

### Phase 4A allowed

- new migration `014`, new pgTAP `0014`, and appended checksum entry;
- new Phase 4 domain/application/render/Telegram modules;
- targeted dispatcher, worker, database-contract/type and E2E helper changes;
- local seed/config fixtures, Phase 4 verifier, tests, checkpoint and project memory;
- this supplemental design and its implementation plan.

### Phase 4A forbidden

- edits to migrations `001–013` or their existing checksum values;
- edits to resolver `v1`, its config, fallback content, schema or golden fixtures;
- partnership, random loot/drop generation, rank progression above Новак, reminders or Track G;
- remote project linking, secrets, deployment, webhook registration or real Telegram calls.

### Phase 4T allowed only after its remote gate

- new forward migration `015`, staging scripts/runbook and owner allowlist boundary;
- staging-only remote migration, functions, secrets and webhook explicitly approved at that gate.

Production remains forbidden.

## 12. Rollback Strategy

Phase 4A uses no down migration. Before any future remote use, migration `014` is applied with the
feature flag disabled, backward-compatible functions are deployed, local/staging checks run, and
only then the owner cohort is enabled. An application rollback leaves expanded tables intact and
returns to the previous compatible function build; it never deletes progression data.

Because a Phase 3 application does not understand blocking tutorial offers, remote rollback after
enabling Phase 4 must first disable new starts and drain or reconcile the single owner profile. This
is acceptable for owner-only staging and must be rehearsed before external testers.

## 13. Deferred Work and Accumulated Product Proposals

- Named book teachers need a source-backed lore extraction; Phase 4 does not invent them.
- Daily content variety remains the largest retention gap after Phase 4. Track G or manually curated
  weeks should follow, but not be folded into onboarding.
- Narrative surprise should come from validated scene consequences and week-level memory, while
  stat checks remain deterministic and explainable.
- The post-choice breakdown should eventually add `«цей апгрейд змінив би результат»` only when a
  counterfactual resolver comparison proves it.
- The partner button should appear only when Phase 6 makes invitation—including a friend who has
  never started the bot—functional end to end.

## 14. Requirement Traceability

| Authoritative requirement | Design evidence | Coverage |
|---|---|---|
| Two actually played tutorial runs, persistent `0/2 → 1/2 → 2/2` | Sections 4.2, 4.4 and 5 | complete |
| Teacher snapshot, contextual lessons and one rescue | Sections 2, 4.2 and 6 | complete |
| Rescue guarantees three meaningful choices | Section 4.2 and Gate 4.2 | complete; first/second-choice lethal paths only |
| Natural terminal, HP-zero and eligible expiry completion | Sections 4.2, 4.4, 5 and Gate 4.3 | complete |
| Start-only and explicit abandon do not count | Sections 4.2, 5, 8 and Gate 4.3 | complete |
| First guided XP purchase after run 1 | Sections 4.2–4.3 | complete; player may explicitly defer |
| Existing stat price and 30-point cap | Section 4.3 | exact ADR 027 formula |
| Guaranteed armor/talisman decision after run 2 | Sections 4.4–4.5 | complete after every valid terminal |
| No inventory; replace/discard semantics | Sections 4.5 and 6 | complete |
| Four equal-budget blue starter rings, no vampirism | Section 4.6 and Gates 4.2–4.3 | complete |
| Compatible ordinary weapon/focus | Section 4.6 | complete and deterministic |
| Stat/item/ring changes do not mutate an active run | Sections 3, 4.3–4.6 and 6 | complete |
| Random item/ring offers disabled in tutorial run 1 | Sections 1 and 4.2 | complete; random drops are outside all Phase 4 |
| Menu grows from two to four useful actions | Sections 4.1 and 4.7 | complete |
| Do not show empty/remote locked systems | Section 4.7 | complete |
| Canonical resume and idempotent transitions | Sections 5–8 and Gates 4.1–4.3 | complete |
| First choice within two messages/taps | Sections 2 and 4.1 | complete |
| External test after implementation through Telegram | Sections 1 and 10 | complete per ADR 046 |
| No premature public launch | Sections 10–12 | complete; owner-only staging and separate remote gate |

### 14.1 Deliberate Supplemental Decisions

ADR 029 showed `Напарник` in the four-button post-tutorial menu, while the same ADR and master
acceptance prohibit empty locked systems. Partnership and invite behavior belong to Phase 6. This
design resolves the conflict by using the fourth useful Phase 4 button for `Допомога`; Phase 6 adds
`Напарник` only when it works end to end. Written approval of this spec approves that temporary menu
revision.

ADR 029 mentions opt-in reminders after the first run, but reminders are not in master Phase 4 scope
and remain a later phase. Phase 4 may show the next 09:00 return hook, but it does not request or send
reminders.

No master Phase 4 scope or acceptance item remains uncovered after these two explicit phase-boundary
clarifications.
