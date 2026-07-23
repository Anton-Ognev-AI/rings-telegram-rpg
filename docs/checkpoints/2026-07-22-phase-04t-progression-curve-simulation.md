# Phase 4T coupled progression-curve simulation

Date: 2026-07-22
Status: approved as reproducible simulation evidence only; no gameplay change

## Question

Can the game adopt `max HP = vitality × 10`, geometric stat costs, and deeper expeditions while keeping stages 1–3/4 accessible and making stage 6 a real early achievement?

## Council finding

Not as independent edits. HP, attrition, thresholds, XP income, rings, equipment and companions form one balance system. In particular, proposed starter HP 50 plus the teacher's 5 HP survives every one of the nine ordinary stages when paired with unchanged V1 neutral damage. Shipping HP alone would amplify the exact overreach observed in Telegram.

The candidate is therefore test-only:

- maximum HP: `vitality × 10`;
- next stat cost after `n` purchases in that stat: `ceil(20 × 1.20^n)`;
- stage threshold: `ceil(5 × 1.35^(stage−1))`;
- neutral damage: `ceil(5 × 1.32^(stage−1))`;
- failure damage: `ceil(6 × 1.40^(stage−1))`;
- current diminishing-defense rule remains the comparison rule.

## Evidence

- Vitality 5/6 maps to candidate maximum HP 50/60; prototype truth remains 40/44.
- First ten candidate stat costs are `20, 24, 29, 35, 42, 50, 60, 72, 86, 104`.
- Thirty purchases in one stat cost 23,648 XP versus 20,320 XP in the prototype. With 43 XP, a player can buy one repeated-specialization point or the first point in two different stats, but not two consecutive points in one stat.
- Candidate thresholds for stages 1–10 are `5, 7, 10, 13, 17, 23, 31, 41, 56, 75`.
- A fitting route with effective power 13 passes four stages; power 25 passes six.
- With candidate HP 55 including the tutorial teacher and defense 6, repeated neutral play completes stage 5 and is defeated at stage 6; repeated failure completes stage 4 and is defeated at stage 5.
- Four deterministic RED→GREEN tests pin these results.
- The full source gate is green: 222 unit and 3 property tests.

## Content cadence recommendation

Use a weekly narrative spine: one named lesson, recurring teacher, location, threat and weekly payoff. Each day supplies a fresh scene sequence, clue wording and encounter mix inside that arc. Stable monster/world rules remain learnable, but the winning button is not an answer key that can be memorized or shared for seven days.

Keep 10 playable stages for the current MVP. The curve is mathematically extensible, but 12 stages need an actual resolver-V2 matrix and Telegram session-length evidence; 20 stages are a future ceiling, not a current content promise.

## Safety boundary and next gate

No migration, resolver/config/golden file, fallback content, staging function or production surface changed. Before a forward-only V2 amendment, simulate actual physical/magical/defensive/healing builds, all ring tiers, three equipment slots, teacher/friend/solo snapshots, earned-XP distributions, success/neutral/failure mixtures and loot eligibility. Then compare 10 and 12 playable stages.
