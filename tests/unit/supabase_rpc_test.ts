import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  type FetchPort,
  SupabaseRpcDatabase,
} from "../../supabase/functions/_shared/infrastructure/supabase-rpc.ts";

Deno.test("Supabase RPC adapter posts only to a bounded RPC endpoint", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: FetchPort = (input, init) => {
    requests.push({ url: String(input), init });
    return Promise.resolve(Response.json({ status: "ok", value: 3 }));
  };
  const database = new SupabaseRpcDatabase(
    "http://127.0.0.1:54321/",
    "synthetic-service-key",
    fetcher,
  );

  const result = await database.call<{ status: string; value: number }>("resume_v1", {
    p_player_id: "player-1",
  });
  assertEquals(result, { status: "ok", value: 3 });
  const captured = requests[0];
  if (!captured) throw new Error("missing_request");
  assertEquals(captured.url, "http://127.0.0.1:54321/rest/v1/rpc/resume_v1");
  assertEquals(captured.init?.method, "POST");
  assertEquals(
    (captured.init?.headers as Record<string, string>).Authorization,
    "Bearer synthetic-service-key",
  );
  assertEquals(captured.init?.body, JSON.stringify({ p_player_id: "player-1" }));
});

Deno.test("Supabase RPC failures never include credentials or response bodies", async () => {
  const secret = "service-role-secret-value";
  const database = new SupabaseRpcDatabase(
    "https://example.invalid",
    secret,
    () => Promise.resolve(new Response(`remote body ${secret}`, { status: 500 })),
  );
  const error = await assertRejects(() => database.call("resume_v1", {})) as Error;
  assertStringIncludes(error.message, "supabase_rpc_500");
  assertEquals(error.message.includes(secret), false);
  assertEquals(error.message.includes("remote body"), false);
});
