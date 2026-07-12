import { assertEquals } from "jsr:@std/assert@1.0.19";
import { reconcileDatabase } from "../../scripts/db/reconcile.ts";
import { withDatabase } from "../../scripts/db/local-database.ts";

Deno.test("cached balances and applied actions reconcile to immutable facts", async () => {
  await withDatabase(async (sql) => {
    assertEquals(await reconcileDatabase(sql), {
      accountMismatches: 0,
      cycleMismatches: 0,
      actionMismatches: 0,
    });
  });
});
