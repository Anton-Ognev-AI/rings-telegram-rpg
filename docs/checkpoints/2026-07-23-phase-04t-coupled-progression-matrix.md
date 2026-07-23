# Phase 4T Coupled Progression Matrix

Date: 2026-07-23
Task: P4T-06F7B2A, P4T-06F8B, P4T-06F10B
Scope: deterministic local simulation only

## Purpose

Test the coupled candidate from ADR 076 against real resolver-V1 evidence before
changing HP, stat costs, rings, party contribution, expedition length, or the
shared XP economy.

This checkpoint does **not** approve a mechanics migration. Migrations 001–017,
resolver V1, fallback content, staging gameplay, recovery, and production remain
unchanged.

## Evidence provenance

- 96 current-V1 starter/survival reports produced by the existing canonical
  fallback content and resolver.
- 480 candidate cells:
  - four build focuses: physical, magical, defensive, healing;
  - three spend strategies: focused stat, balanced stats, ring first;
  - five XP budgets: 43, 150, 2,700, 18,000, 78,000;
  - two equipment states: main slot only, all three slots;
  - four party states: solo, teacher, peer, strong friend.
- Candidate bundle remains exactly:
  - `max HP = vitality × 10`;
  - stat cost `ceil(20 × 1.20^n)`;
  - threshold `ceil(5 × 1.35^(stage−1))`;
  - neutral damage `ceil(5 × 1.32^(stage−1))`;
  - failure damage `ceil(6 × 1.40^(stage−1))`.
- Canonical report SHA-256:
  `99ed3da0b353821fdf3d76caefeaefc1719dfea5db3e161910effcdef5ad28f5`.

The harness reuses the real item catalog, `aggregateParty`, fallback day, and
resolver-V1 reports. Unsupported mechanics remain explicit `null` results
instead of invented projections.

## Matrix result

- Supported candidate cells: 456.
- Unsupported candidate cells: 24.
- The unsupported cells are healing ring-first builds at green, yellow, or
  purple depth across both equipment states and all four party states.
- Current-V1 pairwise dominance: none.
- Candidate baseline pairwise dominance: none.

### Opening depth at 43 XP

With all three equipment slots and focused spending:

| Focus | Solo | Teacher | Peer | Strong friend |
|---|---:|---:|---:|---:|
| Physical | 3 | 4 | 5 | 6 |
| Magical | 3 | 4 | 5 | 6 |
| Defensive | 2 | 2 | 2 | 2 |
| Healing | 2 | 2 | 2 | 2 |

This is not evidence that friends are broken. The canonical party contract
keeps vitality self-only, so a friend improves shared damage/survival but does
not satisfy a vitality fitting check. Changing V1 party aggregation merely to
make the candidate pass would invalidate the evidence.

### Supported fitting depth by XP budget

| XP | Min | Median | Max | Cells reaching stage 6+ |
|---:|---:|---:|---:|---:|
| 43 | 2 | 2 | 6 | 12 / 96 |
| 150 | 2 | 4 | 8 | 20 / 96 |
| 2,700 | 2 | 6 | 9 | 52 / 88 |
| 18,000 | 2 | 7 | 10 | 72 / 88 |
| 78,000 | 2 | 7 | 10 | 76 / 88 |

No supported cell gains fitting reward depth beyond stage 10 when the same
candidate is projected to 12 or 20 stages.

### Reward depth versus survival depth

- 119 supported cells survive neutral attrition beyond stage 10.
- 44 supported cells survive repeated failure attrition beyond stage 10.
- At the ten-stage cap, neutral survival exceeds fitting reward depth in
  350 / 456 cells.
- Failure survival exceeds fitting reward depth in 290 / 456 cells.

Therefore a 12- or 20-stage expedition would currently add mostly unrewarded
survival and Telegram length, not a clearer achievement ladder.

## Earned-XP and long-term economy

The 96 actual V1 reports produce:

- minimum 10 XP;
- p25 25 XP;
- median 28 XP;
- p75 43 XP;
- maximum 60 XP;
- unique values `10, 25, 28, 43, 45, 60`.

Observed daily anchors are 28, 43, and 60 XP. The 90- and 150-XP values remain
explicit scenario assumptions, not observed telemetry.

| Daily XP | One purple ring | Two purple rings |
|---:|---:|---:|
| 28 | 2,786 days / 7.63 years | 5,572 days / 15.27 years |
| 43 | 1,814 days / 4.97 years | 3,628 days / 9.94 years |
| 60 | 1,300 days / 3.56 years | 2,600 days / 7.12 years |
| 90 | 867 days / 2.38 years | 1,734 days / 4.75 years |
| 150 | 520 days / 1.42 years | 1,040 days / 2.85 years |

Thirty purchases in one stat cost 23,648 XP; thirty purchases in all four
stats cost 94,592 XP. At 43 XP, focused spending buys one upgrade while
horizontal spending buys two first upgrades.

This preserves a meaningful early choice, but the purple-ring horizon is
extremely sensitive to real daily XP. No economy migration should be approved
without owner telemetry from complete days.

## Telegram session length

The current ten-stage run requires 11 decisions, or at most 12 with one field
discovery. A 12-stage run requires 13–14 decisions; a 20-stage run requires
21–22. The extra stages are not justified while fitting reward depth still
stops at ten.

## Decision

1. Approve the deterministic harness and its evidence.
2. Keep the playable MVP at ten stages.
3. Do not ship HP ×10, the geometric threshold/attrition bundle, or the mild
   geometric stat curve yet.
4. Split P4T-06F7B2:
   - F7B2A is complete: coupled 480-cell evidence;
   - F7B2B remains open: define the support lane, higher-tier healing output,
     dual-ring stacking, and a forward-only resolver/config V2 amendment.
5. Preserve canonical V1 party aggregation during design. A support mechanic
   must be explicit rather than simulated by relabeling vitality.
6. Recommended stacking rule for the next design review:
   - additive within one output channel, so one yellow `+80%` remains stronger
     than two green `+35% +35%`;
   - distinct channels provide breadth rather than multiplying each other.
7. Require owner session telemetry before changing long-term XP or expedition
   length.

Canonical recommendation:
`keep-10-until-healing-v2-content-and-owner-session-evidence`.

## Verification

- Focused matrix tests: 5 / 5.
- `npm run simulate:starter`: current-V1 XP evidence reproduced.
- `npm run simulate:coupled`: canonical report emitted successfully.
- Full source gate: 230 unit + 3 property tests passed.
