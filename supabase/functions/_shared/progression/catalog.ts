export const STARTER_ITEM_CATALOG = {
  training_sword: {
    label: "Навчальний меч",
    slot: "main",
    bonuses: { physical: 2 },
  },
  apprentice_focus: {
    label: "Учнівський жезл",
    slot: "main",
    bonuses: { magical: 2 },
  },
  training_armor: {
    label: "Навчальний обладунок",
    slot: "armor",
    bonuses: { defense: 2 },
  },
  student_talisman: {
    label: "Учнівський талісман",
    slot: "talisman",
    bonuses: { maxHp: 4 },
  },
} as const;

export const STARTER_RING_CATALOG = {
  weapon: { label: "Кільце зброї", combatBps: 1500 },
  fire: { label: "Кільце вогню", combatBps: 1500 },
  defense: { label: "Кільце захисту", combatBps: 1500 },
  healing: { label: "Кільце лікування", combatBps: 0 },
} as const;

export type StarterItemKey = keyof typeof STARTER_ITEM_CATALOG;
export type StarterRingKind = keyof typeof STARTER_RING_CATALOG;
