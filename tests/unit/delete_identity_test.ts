import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import {
  deleteIdentity,
  deleteTelegramIdentity,
  type IdentityDeletionSink,
} from "../../supabase/functions/_shared/application/delete-identity.ts";

class RecordingDatabase implements DatabasePort {
  readonly calls: string[] = [];
  readonly args: Readonly<Record<string, unknown>>[] = [];
  failFinalize = false;
  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.calls.push(rpc);
    this.args.push(args);
    if (rpc === "finalize_identity_deletion_v1" && this.failFinalize) {
      return Promise.reject(new Error("primary unavailable"));
    }
    return Promise.resolve(
      { status: this.calls.filter((call) => call === rpc).length > 1 ? "cached" : "applied" } as T,
    );
  }
}

class RecordingSink implements IdentityDeletionSink {
  readonly records: string[] = [];
  fail = false;
  recordTombstone(input: { surrogatePlayerId: string; deletionId: string }): Promise<void> {
    if (this.fail) return Promise.reject(new Error("recovery unavailable"));
    if (!this.records.includes(input.deletionId)) this.records.push(input.deletionId);
    return Promise.resolve();
  }
}

Deno.test("identity deletion orders begin, external tombstone, then finalize", async () => {
  const database = new RecordingDatabase();
  const sink = new RecordingSink();
  const result = await deleteIdentity(database, sink, {
    surrogatePlayerId: "player-1",
    deletionId: "deletion-1",
    recordedAt: "2026-07-13T12:00:00.000Z",
  });

  assertEquals(result.status, "applied");
  assertEquals(database.calls, ["begin_identity_deletion_v1", "finalize_identity_deletion_v1"]);
  assertEquals(sink.records, ["deletion-1"]);
});

Deno.test("sink failure leaves deletion pending and skips finalize", async () => {
  const database = new RecordingDatabase();
  const sink = new RecordingSink();
  sink.fail = true;

  await assertRejects(
    () =>
      deleteIdentity(database, sink, {
        surrogatePlayerId: "player-1",
        deletionId: "deletion-1",
        recordedAt: "2026-07-13T12:00:00.000Z",
      }),
    Error,
    "recovery unavailable",
  );
  assertEquals(database.calls, ["begin_identity_deletion_v1"]);
});

Deno.test("retry is safe after finalize failure", async () => {
  const database = new RecordingDatabase();
  const sink = new RecordingSink();
  database.failFinalize = true;
  await assertRejects(() =>
    deleteIdentity(database, sink, {
      surrogatePlayerId: "player-1",
      deletionId: "deletion-1",
      recordedAt: "2026-07-13T12:00:00.000Z",
    })
  );

  database.failFinalize = false;
  const result = await deleteIdentity(database, sink, {
    surrogatePlayerId: "player-1",
    deletionId: "deletion-1",
    recordedAt: "2026-07-13T12:00:00.000Z",
  });
  assertEquals(result.status, "applied");
  assertEquals(sink.records, ["deletion-1"]);
});

Deno.test("Telegram deletion uses the V2 outbox fence on both database transitions", async () => {
  const database = new RecordingDatabase();
  const sink = new RecordingSink();
  const result = await deleteTelegramIdentity(database, sink, {
    surrogatePlayerId: "player-1",
    deletionId: "deletion-1",
    recordedAt: "2026-07-13T12:00:00.000Z",
    attemptedAt: "2026-07-13T12:00:31.000Z",
  });

  assertEquals(result.status, "applied");
  assertEquals(database.calls, [
    "begin_identity_deletion_v2",
    "finalize_identity_deletion_v2",
  ]);
  assertEquals(database.args[0].p_at, "2026-07-13T12:00:31.000Z");
  assertEquals(database.args[1].p_at, "2026-07-13T12:00:31.000Z");
  assertEquals(sink.records, ["deletion-1"]);
});
