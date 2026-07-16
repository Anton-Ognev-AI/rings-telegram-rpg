import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import type { FetchPort } from "../../supabase/functions/_shared/infrastructure/supabase-rpc.ts";
import { SupabaseRecoveryDeletionSink } from "../../supabase/functions/_shared/infrastructure/recovery-supabase.ts";

const recoveryUrl = "https://bbbbbbbbbbbbbbbbbbbb.supabase.co";
const serviceKey = "synthetic-recovery-service-key";
const tombstone = {
  surrogatePlayerId: "60000000-0000-4000-8000-000000000081",
  deletionId: "61000000-0000-5000-8000-000000000081",
  recordedAt: "2026-07-16T12:00:00.000Z",
};

Deno.test("recovery sink sends only the three tombstone fields to the fixed recovery RPC", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: FetchPort = (input, init) => {
    requests.push({ url: String(input), init });
    return Promise.resolve(Response.json({ status: "applied" }));
  };
  const sink = new SupabaseRecoveryDeletionSink(recoveryUrl, serviceKey, fetcher);

  await sink.recordTombstone(tombstone);

  assertEquals(requests.length, 1);
  const captured = requests[0]!;
  assertEquals(
    captured.url,
    `${recoveryUrl}/rest/v1/rpc/record_deletion_tombstone_v1`,
  );
  assertEquals(captured.init?.method, "POST");
  assertEquals(
    JSON.parse(String(captured.init?.body)),
    {
      p_surrogate_player_id: tombstone.surrogatePlayerId,
      p_deletion_id: tombstone.deletionId,
      p_recorded_at: tombstone.recordedAt,
    },
  );
});

Deno.test("recovery sink accepts exact cached replay and rejects remote conflict", async () => {
  const cached = new SupabaseRecoveryDeletionSink(
    recoveryUrl,
    serviceKey,
    () => Promise.resolve(Response.json({ status: "cached" })),
  );
  await cached.recordTombstone(tombstone);

  const rejected = new SupabaseRecoveryDeletionSink(
    recoveryUrl,
    serviceKey,
    () => Promise.resolve(Response.json({ status: "rejected", reason: "tombstone_conflict" })),
  );
  await assertRejects(
    () => rejected.recordTombstone(tombstone),
    Error,
    "recovery_tombstone_rejected",
  );
});

Deno.test("recovery sink fails closed without leaking configuration or response data", async () => {
  for (
    const invalidUrl of [
      "http://bbbbbbbbbbbbbbbbbbbb.supabase.co",
      "https://production.supabase.co",
      "https://bbbbbbbbbbbbbbbbbbbb.supabase.co/path",
    ]
  ) {
    await assertRejects(
      async () => {
        const sink = new SupabaseRecoveryDeletionSink(invalidUrl, serviceKey);
        await sink.recordTombstone(tombstone);
      },
      Error,
      "invalid_recovery_configuration",
    );
  }

  const responseBody = `remote failure ${serviceKey} ${tombstone.deletionId}`;
  const unavailable = new SupabaseRecoveryDeletionSink(
    recoveryUrl,
    serviceKey,
    () => Promise.resolve(new Response(responseBody, { status: 500 })),
  );
  const error = await assertRejects(
    () => unavailable.recordTombstone(tombstone),
  ) as Error;
  assertEquals(error.message, "recovery_tombstone_unavailable");
  for (const sensitive of [serviceKey, responseBody, tombstone.deletionId, recoveryUrl]) {
    assertEquals(error.message.includes(sensitive), false);
  }
});
