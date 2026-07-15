import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  STARTER_ITEM_CATALOG,
  STARTER_RING_CATALOG,
} from "../../supabase/functions/_shared/progression/catalog.ts";
import {
  parseCanonicalBuildView,
} from "../../supabase/functions/_shared/progression/build-view.ts";

const validBuild = {
  selfSnapshot: {
    maxHp: 44,
    physical: 5,
    magical: 9,
    agility: 5,
    vitality: 5,
    defense: 5,
    vampRateBps: 0,
    postHeal: 0,
  },
  loadoutSnapshot: {
    progressionConfig: "progression-v1",
    items: [
      {
        slot: "main",
        itemKey: "apprentice_focus",
        rarity: "ordinary",
        label: "Учнівський жезл",
        bonuses: { magical: 2 },
      },
      {
        slot: "talisman",
        itemKey: "student_talisman",
        rarity: "ordinary",
        label: "Учнівський талісман",
        bonuses: { maxHp: 4 },
      },
    ],
    rings: [
      {
        kind: "fire",
        color: "blue",
        rarity: "ordinary",
        label: "Кільце вогню",
        masteryPercent: 0,
        investedXp: 0,
        blueBudget: 2000,
        combatBps: 1500,
      },
    ],
  },
  breakdown: {
    physical: [
      {
        source: "base",
        label: "Базова фізична сила",
        operation: "add",
        amount: 5,
        result: 5,
        bps: null,
      },
    ],
    magical: [
      {
        source: "base",
        label: "Базова магічна сила",
        operation: "add",
        amount: 5,
        result: 5,
        bps: null,
      },
      {
        source: "purchased",
        label: "Тренування магічної сили",
        operation: "add",
        amount: 1,
        result: 6,
        bps: null,
      },
      {
        source: "item:apprentice_focus",
        label: "Учнівський жезл",
        operation: "add",
        amount: 2,
        result: 8,
        bps: null,
      },
      {
        source: "ring:fire",
        label: "Кільце вогню",
        operation: "multiply",
        amount: 1,
        result: 9,
        bps: 1500,
      },
    ],
    agility: [
      {
        source: "base",
        label: "Базова спритність",
        operation: "add",
        amount: 5,
        result: 5,
        bps: null,
      },
    ],
    vitality: [
      {
        source: "base",
        label: "Базова живучість",
        operation: "add",
        amount: 5,
        result: 5,
        bps: null,
      },
    ],
    defense: [
      {
        source: "base",
        label: "Базовий захист",
        operation: "add",
        amount: 5,
        result: 5,
        bps: null,
      },
    ],
    maxHp: [
      {
        source: "base",
        label: "Базове здоров’я",
        operation: "add",
        amount: 40,
        result: 40,
        bps: null,
      },
      {
        source: "item:student_talisman",
        label: "Учнівський талісман",
        operation: "add",
        amount: 4,
        result: 44,
        bps: null,
      },
    ],
    postHeal: [],
  },
} as const;

Deno.test("canonical build parser accepts the exact server projection without recomputing it", () => {
  assertEquals(parseCanonicalBuildView(validBuild), validBuild);
});

Deno.test("canonical build parser rejects malformed or partial mechanics data", () => {
  assertThrows(
    () =>
      parseCanonicalBuildView({
        ...validBuild,
        selfSnapshot: { ...validBuild.selfSnapshot, magical: 8.5 },
      }),
    Error,
    "invalid_canonical_build",
  );
  assertThrows(
    () =>
      parseCanonicalBuildView({
        ...validBuild,
        breakdown: { ...validBuild.breakdown, defense: undefined },
      }),
    Error,
    "invalid_canonical_build",
  );
  assertThrows(
    () =>
      parseCanonicalBuildView({
        ...validBuild,
        loadoutSnapshot: {
          ...validBuild.loadoutSnapshot,
          rings: [{ ...validBuild.loadoutSnapshot.rings[0], combatBps: 1499 }],
        },
      }),
    Error,
    "invalid_canonical_build",
  );
});

Deno.test("starter catalog exposes only the approved ordinary items and rings", () => {
  assertEquals(STARTER_ITEM_CATALOG, {
    training_sword: { label: "Навчальний меч", slot: "main", bonuses: { physical: 2 } },
    apprentice_focus: { label: "Учнівський жезл", slot: "main", bonuses: { magical: 2 } },
    training_armor: { label: "Навчальний обладунок", slot: "armor", bonuses: { defense: 2 } },
    student_talisman: { label: "Учнівський талісман", slot: "talisman", bonuses: { maxHp: 4 } },
  });
  assertEquals(STARTER_RING_CATALOG, {
    weapon: { label: "Кільце зброї", combatBps: 1500 },
    fire: { label: "Кільце вогню", combatBps: 1500 },
    defense: { label: "Кільце захисту", combatBps: 1500 },
    healing: { label: "Кільце лікування", combatBps: 0 },
  });
});
