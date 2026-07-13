import { assertEquals } from "jsr:@std/assert@1.0.19";
import { handleDayLifecycle } from "../../supabase/functions/day-publish-reset/index.ts";
import { handleOutbox } from "../../supabase/functions/outbox-worker/index.ts";

const configuredSecret = "0123456789abcdef0123456789abcdef";

Deno.test("internal endpoints reject before constructing privileged adapters", async () => {
  const previous = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  Deno.env.set("INTERNAL_FUNCTION_SECRET", configuredSecret);
  try {
    for (const handler of [handleOutbox, handleDayLifecycle]) {
      const missing = await handler(new Request("http://localhost/internal", { method: "POST" }));
      assertEquals(missing.status, 401);
      const wrong = await handler(
        new Request("http://localhost/internal", {
          method: "POST",
          headers: { "X-TgGame-Internal-Secret": `${configuredSecret}x` },
        }),
      );
      assertEquals(wrong.status, 401);
    }
  } finally {
    if (previous === undefined) Deno.env.delete("INTERNAL_FUNCTION_SECRET");
    else Deno.env.set("INTERNAL_FUNCTION_SECRET", previous);
  }
});
