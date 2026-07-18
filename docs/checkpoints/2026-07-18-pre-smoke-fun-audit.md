# Pre-Smoke Fun Audit

**Date:** 2026-07-18

**Status:** approved local diagnostic; no gameplay, content, schema or remote change

## Purpose

Before the private Telegram owner-smoke, re-check the implemented two-day starter loop against the
owner's product goal: early choices and builds must be understandable, development must be visible,
and reaching deeper stages must feel earned. This is an evidence pass, not a replacement for playing
the bot in Telegram.

## Evidence

- The existing 72-cell balance gate remains unchanged: four starter rings, three original policies,
  two party modes and three test archetypes. It still proves deterministic terminal runs, distinct
  ring evidence and zero strict pairwise ring dominance.
- A separate 24-context diagnostic now models a survival-aware player: take the best check only when
  the current party can pass its actual resolver threshold; otherwise take the neutral route.
- The new diagnostic is deterministic and covers all four rings, both tutorial/ordinary party modes
  and all three test archetypes without entering the approved 72-cell dominance gate.
- Against all-neutral play, survival-aware play was never worse in depth or XP. It reached the same
  stage in all 24 contexts and earned more XP in all 24: `45–60` instead of `25`, an improvement of
  `20–35` XP per run.
- Both policies reached stage `9–10` and ended defeated. Therefore neutral is not an optimal reward
  strategy, but the current fallback compresses the meaning of depth: even all-neutral play reaches
  stage 9 in every ordinary starter context.

## Product Findings

### What is ready to test

- Choice results expose the checked stat, own/companion/total contribution, threshold, HP, damage and
  XP deltas.
- Hero and Academy cards expose base/training/item/ring contributions, spendable XP, ring mastery and
  the next progression goal.
- Tutorial assistance and starter builds already make stages 3–5 reachable; a weak build is not
  silently blocked before the player sees progression.
- Neutral choices remain a survivable fallback with a material reward cost, matching the approved
  success/neutral/failure contract.

### Remaining fun risks

1. **Depth compression:** reaching stage 6 may not yet feel like an achievement because an
   all-neutral starter reaches stage 9. The private smoke must distinguish whether the visible reward
   loss is enough or late neutral attrition needs a focused balance/content amendment.
2. **Content monotony:** there is one reviewed fallback day, reused for both tutorial days.
3. **Weak Academy identity:** the runtime still presents a generic duty teacher and generic lesson
   labels even though the verified lore already contains distinct canonical instructors such as
   Торн, Дезмонд, Еллсевира, Альдебран and Вілтан.
4. **No live pacing evidence:** ten Telegram stages, card edits, progression decisions and the
   next-day hook have not yet been experienced in the real client.

## Decision

Do not alter the locked fallback, resolver, coefficients or migrations before the owner-smoke. The
diagnostic has found a concrete depth risk, but Telegram pacing and the felt value of XP/rewards are
the missing evidence. The smallest post-smoke correction should be selected from observed behavior:

1. tune late neutral consequences while preserving neutral continuation;
2. add a second handcrafted day with a distinct encounter rhythm;
3. bind lessons to verified named instructors and their disciplines;
4. only then expand into Phase 5 content generation or broader economy work.

The private owner-smoke runbook now requires redacted product observations for expedition depth/XP,
result clarity, stage-6 achievement, repeated-day monotony, Academy teacher identity and the return
hook. A technically successful deployment cannot by itself close these questions.

## Verification

- Focused Deno test: `10 passed, 0 failed`.
- Full source gate: `193` unit and `3` property tests passed; format, lint and type checks passed.
- Diagnostic contexts: `24/24` deterministic and terminal.
- XP comparison: survival-aware better in `24/24`; worse in `0/24`.
- Depth comparison: survival-aware worse in `0/24`; tied in `24/24`.
- Runtime/content/schema/Telegram/Supabase changes: none.
- Five-role review: `APPROVE_WITH_SMALL_CHANGES`; the required smoke observation checklist was added.
