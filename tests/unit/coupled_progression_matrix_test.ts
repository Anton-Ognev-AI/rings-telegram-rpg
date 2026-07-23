import { assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  generateCoupledProgressionReport,
  validateCandidateRows,
} from "../../scripts/simulate-coupled-progression.ts";

type Depths = Readonly<Record<"10" | "12" | "20", number | null>>;

interface CandidateRow {
  readonly key: string;
  readonly focus: "physical" | "magical" | "defensive" | "healing";
  readonly strategy: "focused_stat" | "balanced_stats" | "ring_first";
  readonly xpBudget: 43 | 150 | 2700 | 18000 | 78000;
  readonly equipment: "main_only" | "full_three";
  readonly party: "solo" | "teacher" | "peer" | "strong_friend";
  readonly supported: boolean;
  readonly ring: {
    readonly kind: "weapon" | "fire" | "defense" | "healing";
    readonly color: "blue" | "green" | "yellow" | "purple";
  };
  readonly fittingDepth: Depths;
  readonly neutralDepth: Depths;
  readonly failureDepth: Depths;
}

interface CoupledReport {
  readonly version: "coupled-progression-matrix-v1";
  readonly provenance: {
    readonly currentV1: string;
    readonly candidateV2: string;
    readonly healingUnsupported: string;
  };
  readonly coverage: {
    readonly unsupported: readonly string[];
  };
  readonly currentV1: {
    readonly reportCount: number;
    readonly dominancePairs: readonly unknown[];
    readonly baselineDominancePairs: readonly unknown[];
    readonly earnedXp: {
      readonly samples: number;
      readonly min: number;
      readonly p25: number;
      readonly median: number;
      readonly p75: number;
      readonly max: number;
      readonly unique: readonly number[];
    };
  };
  readonly candidateV2: {
    readonly rows: readonly CandidateRow[];
  };
  readonly economy: {
    readonly observedDailyXp: readonly number[];
    readonly scenarioDailyXp: readonly number[];
    readonly ringMilestones: readonly {
      readonly dailyXp: number;
      readonly onePurpleDays: number;
      readonly onePurpleYears: number;
      readonly twoPurpleDays: number;
      readonly twoPurpleYears: number;
    }[];
    readonly focusedStatCapXp: number;
    readonly balancedFourStatCapXp: number;
    readonly early43: {
      readonly focusedPurchases: number;
      readonly balancedPurchases: number;
    };
  };
  readonly sessionLoad: readonly {
    readonly stages: 10 | 12 | 20;
    readonly decisions: number;
    readonly maximumWithOneOffer: number;
  }[];
  readonly recommendation: string;
  readonly reportHash: string;
}

function row(
  report: CoupledReport,
  expected: Pick<CandidateRow, "focus" | "strategy" | "xpBudget" | "equipment" | "party">,
): CandidateRow {
  const found = report.candidateV2.rows.find((candidate) =>
    candidate.focus === expected.focus &&
    candidate.strategy === expected.strategy &&
    candidate.xpBudget === expected.xpBudget &&
    candidate.equipment === expected.equipment &&
    candidate.party === expected.party
  );
  if (!found) throw new Error("missing_candidate_row");
  return found;
}

Deno.test("coupled report separates current truth, candidate evidence, and unsupported mechanics", async () => {
  const first = await generateCoupledProgressionReport() as unknown as CoupledReport;
  const second = await generateCoupledProgressionReport() as unknown as CoupledReport;

  assertEquals(first, second);
  assertEquals(first.version, "coupled-progression-matrix-v1");
  assertEquals(first.provenance, {
    currentV1: "resolver-v1+fallback-day-01+starter-matrix",
    candidateV2: "adr-076+game-design-v1.1+aggregate-party",
    healingUnsupported: "missing-higher-color-healing-output",
  });
  assertEquals(first.coverage.unsupported, [
    "healing:green",
    "healing:yellow",
    "healing:purple",
  ]);
  assertEquals(first.currentV1.reportCount, 96);
  assertEquals(first.currentV1.dominancePairs, []);
  assertEquals(first.currentV1.baselineDominancePairs, []);
  assertEquals(first.currentV1.earnedXp, {
    samples: 96,
    min: 10,
    p25: 25,
    median: 28,
    p75: 43,
    max: 60,
    unique: [10, 25, 28, 43, 45, 60],
  });
  assertMatch(first.reportHash, /^[0-9a-f]{64}$/u);
});

Deno.test("candidate matrix is complete, unique, and fails closed", async () => {
  const report = await generateCoupledProgressionReport() as unknown as CoupledReport;
  const rows = report.candidateV2.rows;

  assertEquals(rows.length, 480);
  assertEquals(new Set(rows.map((candidate) => candidate.key)).size, rows.length);
  assertEquals(rows.filter((candidate) => !candidate.supported).length, 24);
  assertEquals(
    rows.filter((candidate) => !candidate.supported).every((candidate) =>
      candidate.ring.kind === "healing" &&
      candidate.ring.color !== "blue" &&
      Object.values(candidate.fittingDepth).every((depth) => depth === null) &&
      Object.values(candidate.neutralDepth).every((depth) => depth === null) &&
      Object.values(candidate.failureDepth).every((depth) => depth === null)
    ),
    true,
  );
  assertEquals(
    rows.filter((candidate) => candidate.supported).every((candidate) =>
      Object.values(candidate.fittingDepth).every((depth) => depth !== null) &&
      Object.values(candidate.neutralDepth).every((depth) => depth !== null) &&
      Object.values(candidate.failureDepth).every((depth) => depth !== null)
    ),
    true,
  );

  assertThrows(
    () => validateCandidateRows(rows.slice(1)),
    Error,
    "incomplete_candidate_progression_matrix",
  );
  assertThrows(
    () => validateCandidateRows([rows[1]!, ...rows.slice(1)]),
    Error,
    "incomplete_candidate_progression_matrix",
  );
  assertThrows(
    () => {
      const unsupported = rows.find((candidate) => !candidate.supported);
      if (!unsupported) throw new Error("missing_unsupported_candidate");
      validateCandidateRows(
        rows.map((candidate) =>
          candidate.key === unsupported.key
            ? { ...candidate, fittingDepth: { "10": 1, "12": 1, "20": 1 } }
            : candidate
        ),
      );
    },
    Error,
    "invalid_unsupported_candidate_depth",
  );
});

Deno.test("candidate preserves an accessible opening and makes stage six earned", async () => {
  const report = await generateCoupledProgressionReport() as unknown as CoupledReport;
  const base = {
    focus: "physical",
    strategy: "focused_stat",
    xpBudget: 43,
    equipment: "full_three",
  } as const;

  assertEquals(row(report, { ...base, party: "solo" }).fittingDepth["10"], 3);
  assertEquals(row(report, { ...base, party: "teacher" }).fittingDepth["10"], 4);
  assertEquals(row(report, { ...base, party: "strong_friend" }).fittingDepth["10"], 6);
});

Deno.test("economy keeps purple progression multi-year without hiding horizontal choices", async () => {
  const report = await generateCoupledProgressionReport() as unknown as CoupledReport;
  const xp90 = report.economy.ringMilestones.find((row) => row.dailyXp === 90);
  const xp150 = report.economy.ringMilestones.find((row) => row.dailyXp === 150);
  const xp43 = report.economy.ringMilestones.find((row) => row.dailyXp === 43);

  assertEquals(report.economy.observedDailyXp, [28, 43, 60]);
  assertEquals(report.economy.scenarioDailyXp, [90, 150]);
  assertEquals(xp43, {
    dailyXp: 43,
    onePurpleDays: 1814,
    onePurpleYears: 4.97,
    twoPurpleDays: 3628,
    twoPurpleYears: 9.94,
  });
  assertEquals(xp90, {
    dailyXp: 90,
    onePurpleDays: 867,
    onePurpleYears: 2.38,
    twoPurpleDays: 1734,
    twoPurpleYears: 4.75,
  });
  assertEquals(xp150, {
    dailyXp: 150,
    onePurpleDays: 520,
    onePurpleYears: 1.42,
    twoPurpleDays: 1040,
    twoPurpleYears: 2.85,
  });
  assertEquals(report.economy.focusedStatCapXp, 23_648);
  assertEquals(report.economy.balancedFourStatCapXp, 94_592);
  assertEquals(report.economy.early43, {
    focusedPurchases: 1,
    balancedPurchases: 2,
  });
});

Deno.test("session comparison measures decisions and keeps twelve stages behind telemetry", async () => {
  const report = await generateCoupledProgressionReport() as unknown as CoupledReport;

  assertEquals(report.sessionLoad, [
    { stages: 10, decisions: 11, maximumWithOneOffer: 12 },
    { stages: 12, decisions: 13, maximumWithOneOffer: 14 },
    { stages: 20, decisions: 21, maximumWithOneOffer: 22 },
  ]);
  assertEquals(
    report.recommendation,
    "keep-10-until-healing-v2-content-and-owner-session-evidence",
  );
});
