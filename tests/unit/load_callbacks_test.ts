import { assertEquals } from "jsr:@std/assert@1.0.19";
import { loadGatePasses, percentile } from "../../scripts/load-callbacks.ts";

Deno.test("callback load percentiles are deterministic and use nearest-rank selection", () => {
  assertEquals(percentile([4, 1, 3, 2], 0.5), 2);
  assertEquals(percentile([4, 1, 3, 2], 0.95), 4);
  assertEquals(percentile([7], 0.99), 7);
});

Deno.test("callback load gate rejects latency, errors, duplicate effects, loss, or queue growth", () => {
  const passing = {
    callbackCount: 6000,
    canonicalRunCount: 60,
    acknowledgementP95Ms: 12,
    effectiveThroughputPerSecond: 10,
    errorCount: 0,
    duplicateEffects: 0,
    lostCanonicalOutcomes: 0,
    maximumOutboxBacklog: 10,
    finalOutboxBacklog: 0,
  };
  assertEquals(loadGatePasses(passing), true);
  for (
    const override of [
      { acknowledgementP95Ms: 2000 },
      { canonicalRunCount: 59 },
      { effectiveThroughputPerSecond: 9.99 },
      { errorCount: 1 },
      { duplicateEffects: 1 },
      { lostCanonicalOutcomes: 1 },
      { maximumOutboxBacklog: 11 },
      { finalOutboxBacklog: 1 },
    ]
  ) {
    assertEquals(loadGatePasses({ ...passing, ...override }), false);
  }
});
