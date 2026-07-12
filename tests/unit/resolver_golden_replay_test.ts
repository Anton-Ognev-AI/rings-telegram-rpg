import { assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import goldenRun from "../fixtures/replays/v1/golden-full-run.json" with { type: "json" };
import goldenResult from "../fixtures/replays/v1/golden-full-run.result.json" with { type: "json" };
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import type {
  ChoiceCommandV1,
  PartySnapshot,
  ResolutionV1,
  RunStateV1,
} from "../../supabase/functions/_shared/contracts/domain.ts";
import {
  canonicalJson,
  sha256Hex,
} from "../../supabase/functions/_shared/domain/canonical-json.ts";
import {
  getResolver,
  resolveAndHash,
} from "../../supabase/functions/_shared/domain/resolver-registry.ts";
import { advanceStateV1 } from "../../supabase/functions/_shared/domain/resolvers/v1/resolver.ts";

Deno.test("canonical JSON recursively sorts object keys and preserves arrays", () => {
  assertEquals(
    canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 2, a: 1 }] }),
    '{"a":{"x":3,"y":2},"list":[{"a":1,"b":2}],"z":1}',
  );
});

Deno.test("canonical JSON rejects values without stable JSON meaning", () => {
  assertThrows(() => canonicalJson({ value: undefined }), Error, "$.value");
  assertThrows(() => canonicalJson({ value: Number.NaN }), Error, "$.value");
});

Deno.test("resolver registry is closed to unsupported versions", () => {
  assertThrows(
    () => getResolver("v2" as "v1"),
    Error,
    "Unsupported resolver version: v2",
  );
  assertEquals(typeof getResolver("v1").resolveChoice, "function");
});

Deno.test("golden full run pins final state and transcript hash", async () => {
  const content = fallback as unknown as DungeonContentV1;
  const party: PartySnapshot = {
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
  let state: RunStateV1 = {
    stage: 1,
    exchange: null,
    hp: 100,
    bossHp: null,
    xp: 0,
    vampHealedStage: 0,
    vampHealedRun: 0,
    terminal: null,
  };
  const resolutions: ResolutionV1[] = [];
  for (const selection of goldenRun.choices) {
    const command = { resolverVersion: "v1", ...selection } as ChoiceCommandV1;
    const replay = await resolveAndHash({ content, party, state, command });
    resolutions.push(replay.resolution);
    state = advanceStateV1(state, replay.resolution);
  }
  const fullRunHash = await sha256Hex(canonicalJson({ resolutions, finalState: state }));
  assertEquals(resolutions.length, 11);
  assertEquals(state, goldenResult.finalState as RunStateV1);
  assertMatch(fullRunHash, /^[0-9a-f]{64}$/);
  assertEquals(fullRunHash, goldenResult.fullRunHash);
});
