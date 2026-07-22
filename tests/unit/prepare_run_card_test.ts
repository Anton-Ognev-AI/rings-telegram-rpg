import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.19";
import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import {
  prepareRunCard,
  type TelegramRunView,
} from "../../supabase/functions/_shared/application/prepare-run-card.ts";

class RecordingDatabase implements DatabasePort {
  readonly calls: Array<{ rpc: string; args: Readonly<Record<string, unknown>> }> = [];

  constructor(private readonly status = "ok") {}

  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push({ rpc, args });
    return Promise.resolve({ status: this.status } as T);
  }
}

const view: TelegramRunView = {
  status: "ok",
  run: {
    id: "20000000-0000-4000-8000-000000000001",
    playerId: "10000000-0000-4000-8000-000000000001",
    cycleId: "2026-08-25",
    status: "active",
    phase: "awaiting_choice",
    stateVersion: 4,
    stage: 1,
    exchange: null,
    hp: 100,
    maxHp: 100,
    bossHp: null,
    xpEarned: 0,
  },
  selfSnapshot: {
    maxHp: 100,
    physical: 70,
    magical: 70,
    agility: 70,
    vitality: 70,
    defense: 0,
    vampRateBps: 0,
    postHeal: 0,
  },
  loadout: { partyMode: "solo", companion: null, items: [], rings: [] },
  content: fallback as DungeonContentV1,
  cycle: {
    cycleId: "2026-08-25",
    opensAt: "2026-08-25T06:00:00.000Z",
    closesAt: "2026-08-26T06:00:00.000Z",
    graceEndsAt: "2026-08-26T08:00:00.000Z",
    status: "open",
  },
  lastResolution: null,
  card: null,
};

Deno.test("prepareRunCard resolves and persists every visible choice", async () => {
  const database = new RecordingDatabase();
  const stageChoices = fallback.stages[0].choices!;
  const prepared = await prepareRunCard(
    database,
    view,
    new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
  );

  assertEquals(prepared.choices.length, stageChoices.length);
  assertEquals(database.calls.length, prepared.choices.length);
  assertEquals(database.calls.every((call) => call.rpc === "prepare_action_v3"), true);
  assertEquals(prepared.state.stage, 1);
  assertEquals(prepared.party.mode, "solo");

  for (const [index, choice] of prepared.choices.entries()) {
    const expectedChoice = stageChoices[index]!;
    assertEquals(choice.choiceId, expectedChoice.id);
    assertEquals(choice.label, expectedChoice.label);
    assertEquals(new TextEncoder().encode(choice.callbackData).byteLength <= 64, true);
    assertMatch(choice.tokenSha256, /^[0-9a-f]{64}$/);
    assertMatch(choice.contextSha256, /^[0-9a-f]{64}$/);
    assertMatch(choice.resolutionSha256, /^[0-9a-f]{64}$/);
    assertEquals(choice.callbackData.includes(view.run.id), false);
  }

  const firstArgs = database.calls[0].args;
  assertEquals(firstArgs.p_player_id, view.run.playerId);
  assertEquals(firstArgs.p_run_id, view.run.id);
  assertEquals(firstArgs.p_expected_state_version, view.run.stateVersion);
  assertEquals(firstArgs.p_stage, 1);
  assertEquals(firstArgs.p_exchange, 0);
  assertEquals(firstArgs.p_expires_at, view.cycle.graceEndsAt);
  assertEquals(firstArgs.p_tutorial_adapter, null);
  assertEquals(
    (firstArgs.p_prepared_resolution as { outcome: string }).outcome,
    "success",
  );
});

Deno.test("prepareRunCard applies and persists only the canonical teacher rescue", async () => {
  const database = new RecordingDatabase();
  const tutorialView: TelegramRunView = {
    ...view,
    run: { ...view.run, hp: 1, maxHp: 45 },
    selfSnapshot: {
      maxHp: 40,
      physical: 0,
      magical: 0,
      agility: 0,
      vitality: 0,
      defense: 0,
      vampRateBps: 0,
      postHeal: 0,
    },
    loadout: {
      partyMode: "tutorial",
      companion: { maxHp: 5, physical: 4, magical: 4, agility: 4, defense: 2 },
      items: [],
      rings: [],
    },
    tutorial: {
      ordinal: 1,
      guidance: "full",
      rescueUsed: false,
      resultCount: 0,
    },
  };

  const prepared = await prepareRunCard(
    database,
    tutorialView,
    new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
  );
  const rescued = prepared.choices.filter((choice) => choice.resolution.tutorial?.teacherRescue);

  assertEquals(rescued.length > 0, true);
  for (const choice of rescued) {
    assertEquals(choice.resolution.hp.after, 23);
    assertEquals(choice.resolution.terminal, null);
    assertEquals(choice.resolution.nextStage, 2);
    const call = database.calls.find((entry) => entry.args.p_choice_id === choice.choiceId)!;
    assertEquals(call.args.p_tutorial_adapter, {
      teacherRescue: true,
      teacherRestore: 23,
    });
    assertEquals(call.args.p_prepared_resolution, choice.resolution);
  }
});

Deno.test("prepareRunCard accepts idempotently cached prepared choices after restart", async () => {
  const database = new RecordingDatabase("cached");
  const prepared = await prepareRunCard(
    database,
    view,
    new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
  );
  assertEquals(prepared.choices.length, fallback.stages[0].choices?.length);
});

Deno.test("prepareRunCard returns no choices for a terminal run", async () => {
  const database = new RecordingDatabase();
  const prepared = await prepareRunCard(
    database,
    {
      ...view,
      run: { ...view.run, status: "completed" },
      lastResolution: { terminal: "victory" },
    },
    new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
  );
  assertEquals(prepared.choices, []);
  assertEquals(database.calls, []);
});
