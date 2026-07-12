import type { AggregatedParty, PartySnapshot } from "../../../contracts/domain.ts";

export function aggregateParty(snapshot: PartySnapshot): AggregatedParty {
  const { self } = snapshot;
  const companion = snapshot.companion;
  if (companion === null) {
    return {
      mode: snapshot.mode,
      total: {
        maxHp: self.maxHp,
        physical: self.physical,
        magical: self.magical,
        agility: self.agility,
        vitality: self.vitality,
        defense: self.defense,
      },
      support: { vampRateBps: self.vampRateBps, postHeal: self.postHeal },
      breakdown: {
        self,
        companion: null,
        agilityAssist: 0,
        defenseAssist: 0,
      },
    };
  }

  const agilityAssist = Math.floor(Math.min(self.agility, companion.agility) / 4);
  const defenseAssist = Math.floor(Math.min(self.defense, companion.defense) / 2);
  return {
    mode: snapshot.mode,
    total: {
      maxHp: self.maxHp + companion.maxHp,
      physical: self.physical + companion.physical,
      magical: self.magical + companion.magical,
      agility: Math.max(self.agility, companion.agility) + agilityAssist,
      vitality: self.vitality,
      defense: Math.max(self.defense, companion.defense) + defenseAssist,
    },
    support: { vampRateBps: self.vampRateBps, postHeal: self.postHeal },
    breakdown: { self, companion, agilityAssist, defenseAssist },
  };
}
