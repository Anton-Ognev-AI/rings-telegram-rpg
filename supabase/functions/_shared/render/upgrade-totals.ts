export interface UpgradeTotals {
  readonly maxHp?: {
    readonly current: number;
    readonly next: number;
  };
  readonly defense?: {
    readonly current: number;
    readonly next: number;
  };
}

export function renderUpgradeTotals(totals: UpgradeTotals | undefined): readonly string[] {
  if (!totals) return [];
  const lines: string[] = [];
  if (totals.maxHp && totals.maxHp.next !== totals.maxHp.current) {
    lines.push(`Максимум HP: ${totals.maxHp.current} → ${totals.maxHp.next}`);
  }
  if (totals.defense && totals.defense.next !== totals.defense.current) {
    lines.push(`Захист: ${totals.defense.current} → ${totals.defense.next}`);
  }
  return lines;
}
