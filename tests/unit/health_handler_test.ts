import { assertEquals } from "jsr:@std/assert@1.0.19";
import { handleHealth } from "../../supabase/functions/health/handler.ts";

Deno.test("health handler returns a stable service response", async () => {
  const response = handleHealth(new Request("http://localhost/health"));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "telegram-academy",
  });
});
