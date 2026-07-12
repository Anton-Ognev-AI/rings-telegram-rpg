import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import contained from "../fixtures/replays/v1/contained.json" with { type: "json" };
import defeated from "../fixtures/replays/v1/defeated.json" with { type: "json" };
import doubleZero from "../fixtures/replays/v1/double-zero-prevented.json" with { type: "json" };
import failure from "../fixtures/replays/v1/failure.json" with { type: "json" };
import neutral from "../fixtures/replays/v1/neutral.json" with { type: "json" };
import success from "../fixtures/replays/v1/success.json" with { type: "json" };
import trap from "../fixtures/replays/v1/trap.json" with { type: "json" };
import victory from "../fixtures/replays/v1/victory.json" with { type: "json" };
import type {
  ChoiceCommandV1,
  PartySnapshot,
  RunStateV1,
} from "../../supabase/functions/_shared/contracts/domain.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import { CONFIG_V1 } from "../../supabase/functions/_shared/domain/resolvers/v1/config.ts";
import {
  advanceStateV1,
  resolveChoiceV1,
} from "../../supabase/functions/_shared/domain/resolvers/v1/resolver.ts";

const strong: PartySnapshot = {
  mode: "solo",
  self: {
    maxHp: 100,
    physical: 70,
    magical: 70,
    agility: 70,
    vitality: 70,
    defense: 0,
    vampRateBps: 0,
    postHeal: 0,
  },
  companion: null,
};
const weak: PartySnapshot = {
  mode: "solo",
  self: {
    maxHp: 100,
    physical: 0,
    magical: 0,
    agility: 0,
    vitality: 0,
    defense: 0,
    vampRateBps: 0,
    postHeal: 0,
  },
  companion: null,
};
const content = fallback as unknown as DungeonContentV1;

type Fixture = {
  build: "strong" | "weak";
  state: RunStateV1;
  command: ChoiceCommandV1;
  expected: {
    outcome: string;
    hp: number;
    bossHp?: number;
    xpDelta: number;
    terminal: string | null;
  };
};

for (
  const [name, raw] of Object.entries({
    success,
    neutral,
    failure,
    trap,
    defeated,
    victory,
    contained,
    doubleZero,
  })
) {
  Deno.test(`resolver replays ${name}`, () => {
    const fixture = raw as unknown as Fixture;
    const resolution = resolveChoiceV1({
      content,
      party: fixture.build === "strong" ? strong : weak,
      state: fixture.state,
      command: fixture.command,
    });
    assertEquals(resolution.outcome, fixture.expected.outcome);
    assertEquals(resolution.hp.after, fixture.expected.hp);
    assertEquals(resolution.bossHp?.after, fixture.expected.bossHp);
    assertEquals(resolution.xp.delta, fixture.expected.xpDelta);
    assertEquals(resolution.terminal, fixture.expected.terminal);
  });
}

Deno.test("v1 XP budget is 150 with exactly 90 through stage 5", () => {
  assertEquals(CONFIG_V1.stageXp.reduce((sum, xp) => sum + xp, 0), 150);
  assertEquals(CONFIG_V1.stageXp.slice(0, 5).reduce((sum, xp) => sum + xp, 0), 90);
});

Deno.test("first boss exchange cannot win and advances only while alive", () => {
  const base: RunStateV1 = {
    stage: 10,
    exchange: null,
    hp: 100,
    bossHp: null,
    xp: 100,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  const command: ChoiceCommandV1 = {
    resolverVersion: "v1",
    stage: 10,
    exchange: 1,
    choiceId: "s10e1-physical",
  };
  const alive = resolveChoiceV1({ content, party: strong, state: base, command });
  assertEquals(
    { terminal: alive.terminal, next: alive.nextExchange, bossHp: alive.bossHp?.after },
    {
      terminal: null,
      next: 2,
      bossHp: 58,
    },
  );
  const lethal = resolveChoiceV1({ content, party: weak, state: { ...base, hp: 5 }, command });
  assertEquals({ terminal: lethal.terminal, next: lethal.nextExchange }, {
    terminal: "defeated",
    next: null,
  });
});

Deno.test("advanceStateV1 carries replay outputs and resets per-stage vamp", () => {
  const fixture = success as unknown as Fixture;
  const resolution = resolveChoiceV1({
    content,
    party: strong,
    state: fixture.state,
    command: fixture.command,
  });
  assertEquals(advanceStateV1(fixture.state, resolution), {
    stage: 2,
    exchange: null,
    hp: 100,
    bossHp: null,
    xp: 10,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  });
});

Deno.test("resolver rejects forged nonterminal resource snapshots", () => {
  const fixture = success as unknown as Fixture;
  const resolve = (state: RunStateV1) =>
    resolveChoiceV1({ content, party: strong, state, command: fixture.command });
  assertThrows(
    () => resolve({ ...fixture.state, hp: 0 }),
    Error,
    "Nonterminal run must have positive HP",
  );
  assertThrows(
    () => resolve({ ...fixture.state, xp: 151 }),
    Error,
    "Run XP must be between 0 and 150",
  );
  assertThrows(
    () =>
      resolveChoiceV1({
        content,
        party: strong,
        state: { ...fixture.state, stage: 10, exchange: 2, bossHp: 91 },
        command: { resolverVersion: "v1", stage: 10, exchange: 2, choiceId: "s10e2-magical" },
      }),
    Error,
    "Carried boss HP is outside configured bounds",
  );
});
