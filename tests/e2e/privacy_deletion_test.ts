import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import type { Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  ensureRecoveryDatabase,
  LocalRecoveryDeletionSink,
  withRecoveryDatabase,
} from "../../scripts/recovery/local-recovery-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import type { DatabasePort } from "../../supabase/functions/_shared/application/database-port.ts";
import type { IdentityDeletionSink } from "../../supabase/functions/_shared/application/delete-identity.ts";
import { processOutboxBatch } from "../../supabase/functions/_shared/application/process-outbox.ts";
import { FixedClock } from "../../supabase/functions/_shared/infrastructure/clock.ts";
import { RecordingTelegramPort } from "../../supabase/functions/_shared/telegram/fake.ts";
import {
  handleTelegramUpdate,
  type TelegramHandlerDependencies,
} from "../../supabase/functions/_shared/telegram/handler.ts";
import { normalizeTelegramUpdate } from "../../supabase/functions/_shared/telegram/update.ts";
import callbackFixture from "../fixtures/telegram/callback.json" with { type: "json" };
import startFixture from "../fixtures/telegram/start.json" with { type: "json" };
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";
import { CALLBACK_KEY } from "./helpers/telegram-flow.ts";

const at = "2026-09-18T07:00:00.000Z";
const externalIdBase = 1_000_000_000 +
  (crypto.getRandomValues(new Uint32Array(1))[0]! % 100_000_000) * 10;
const developedBuild: NonNullable<TelegramHandlerDependencies["startBuild"]> = {
  selfSnapshot: {
    maxHp: 100,
    physical: 70,
    magical: 70,
    agility: 70,
    vitality: 70,
    defense: 0,
    vampRateBps: 0,
    postHeal: 0,
  },
  loadoutSnapshot: { partyMode: "solo", companion: null, items: [], rings: [] },
};

function command(externalId: number, text: string, updateId: number) {
  return normalizeTelegramUpdate({
    ...startFixture,
    update_id: updateId,
    message: {
      ...startFixture.message,
      from: { id: externalId },
      chat: { id: externalId },
      text,
    },
  });
}

function callback(externalId: number, data: string, updateId: number) {
  return normalizeTelegramUpdate({
    ...callbackFixture,
    update_id: updateId,
    callback_query: {
      ...callbackFixture.callback_query,
      id: `privacy-deletion-${externalId}-${updateId}`,
      from: { id: externalId },
      message: {
        ...callbackFixture.callback_query.message,
        chat: { id: externalId },
      },
      data,
    },
  });
}

function dependencies(
  database: DatabasePort,
  telegram: RecordingTelegramPort,
  deletionSink: IdentityDeletionSink,
  now = at,
): TelegramHandlerDependencies {
  return {
    database,
    telegram,
    deletionSink,
    clock: new FixedClock(now),
    callbackKey: CALLBACK_KEY,
    startBuild: developedBuild,
  };
}

async function handle(
  database: DatabasePort,
  deletionSink: IdentityDeletionSink,
  update: ReturnType<typeof command>,
  now = at,
) {
  const telegram = new RecordingTelegramPort();
  const result = await handleTelegramUpdate(
    dependencies(database, telegram, deletionSink, now),
    update,
  );
  return { result, telegram };
}

function firstCallback(telegram: RecordingTelegramPort): string {
  const sent = telegram.calls.find((call) => call.operation === "sendMessage");
  if (!sent || sent.operation !== "sendMessage") throw new Error("missing_message");
  const data = sent.input.buttons?.flat()[0]?.callbackData;
  if (!data) throw new Error("missing_callback");
  return data;
}

async function linkedIdentity(sql: Sql, externalId: number) {
  const [row] = await sql<{
    player_id: string;
    deletion_state: string;
    deletion_id: string | null;
  }[]>`select p.id as player_id, p.deletion_state, p.deletion_id
    from game.identity_links il join game.players p on p.id = il.player_id
    where il.platform = 'telegram' and il.external_id = ${String(externalId)}::bigint`;
  return row;
}

async function actionableOutbox(sql: Sql, playerId: string) {
  const [row] = await sql<{ pending: number; leased: number }[]>`select
      count(*) filter (where o.status = 'pending')::integer as pending,
      count(*) filter (where o.status = 'leased')::integer as leased
    from game.outbox_messages o
    join game.runs r on r.id::text = o.payload->>'runId'
    where r.player_id = ${playerId}::uuid`;
  if (!row) throw new Error("missing_outbox_counts");
  return row;
}

class OneShotFinalizeFault implements DatabasePort {
  #remaining = 1;

  constructor(
    private readonly inner: DatabasePort,
    private readonly timing: "before_commit" | "after_commit",
  ) {}

  async call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    if (rpc !== "finalize_identity_deletion_v2" || this.#remaining === 0) {
      return await this.inner.call<T>(rpc, args);
    }
    this.#remaining -= 1;
    if (this.timing === "before_commit") throw new Error("synthetic_finalize_unavailable");
    await this.inner.call<T>(rpc, args);
    throw new Error("synthetic_finalize_response_lost");
  }
}

Deno.test("privacy is available before and during a run, while deletion stays explicit and retryable", async () => {
  await ensureRecoveryDatabase();
  await withDatabase(async (sql) => {
    const externalId = externalIdBase + 1;
    const database = new PostgresRpcDatabase(sql);
    const sink = new LocalRecoveryDeletionSink();

    const privacyBefore = await handle(database, sink, command(externalId, "/privacy", 970301));
    assertEquals(privacyBefore.result.route, "privacy");
    const privacyMessage = privacyBefore.telegram.calls[0];
    if (!privacyMessage || privacyMessage.operation !== "sendMessage") {
      throw new Error("missing_privacy_message");
    }
    assertStringIncludes(privacyMessage.input.text, "Telegram ID");
    assertEquals(await linkedIdentity(sql, externalId), undefined);

    assertEquals(
      (await handle(database, sink, command(externalId, "/start", 970302))).result.route,
      "onboarding",
    );
    assertEquals(
      ["applied", "cached"].includes(String((await publishFallbackDay(database, at)).status)),
      true,
    );
    assertEquals((await advanceDay(database, at)).status, "ok");
    assertEquals(
      (await handle(database, sink, callback(externalId, "nav:expedition", 970303))).result.route,
      "expedition_started",
    );
    assertEquals(
      (await handle(database, sink, command(externalId, "/privacy", 970304))).result.route,
      "privacy",
    );

    const beforePrompt = await linkedIdentity(sql, externalId);
    if (!beforePrompt) throw new Error("missing_identity_before_prompt");
    const prompt = await handle(database, sink, command(externalId, "/delete_me", 970305));
    assertEquals(prompt.result.route, "delete_confirmation");
    const token = firstCallback(prompt.telegram);
    assertEquals((await linkedIdentity(sql, externalId))?.deletion_state, "active");

    const forwardedExternalId = externalId + 100;
    await handle(database, sink, command(forwardedExternalId, "/start", 970350));
    assertEquals(
      (await handle(
        database,
        sink,
        callback(forwardedExternalId, token, 970351),
      )).result.route,
      "deletion_rejected",
    );
    assertEquals((await linkedIdentity(sql, forwardedExternalId))?.deletion_state, "active");

    const failed = await handle(
      database,
      { recordTombstone: () => Promise.reject(new Error("synthetic_recovery_failure")) },
      callback(externalId, token, 970306),
    );
    assertEquals(failed.result.route, "deletion_retryable");
    assertEquals((await linkedIdentity(sql, externalId))?.deletion_state, "deletion_pending");
    assertEquals(await actionableOutbox(sql, beforePrompt.player_id), { pending: 0, leased: 0 });
    const pendingWorkerTelegram = new RecordingTelegramPort();
    const pendingWorker = await processOutboxBatch(
      dependencies(database, pendingWorkerTelegram, sink),
      {
        workerId: "50000000-0000-4000-8000-000000000091",
        limit: 10,
        leaseSeconds: 30,
      },
    );
    assertEquals(pendingWorker.leased, 0);
    assertEquals(pendingWorkerTelegram.calls, []);
    assertEquals(
      (await handle(database, sink, command(externalId, "/start", 970307))).result.route,
      "identity_pending",
    );

    assertEquals(
      (await handle(database, sink, callback(externalId, token, 970308))).result.route,
      "deleted",
    );
    assertEquals(await linkedIdentity(sql, externalId), undefined);
    const oldPlayerId = beforePrompt.player_id;
    const [tombstone] = await withRecoveryDatabase((recovery) =>
      recovery<{ count: number }[]>`select count(*)::integer as count
        from recovery.deletion_tombstones where surrogate_player_id = ${oldPlayerId}::uuid`
    );
    assertEquals(tombstone.count, 1);

    assertEquals(
      (await handle(database, sink, command(externalId, "/start", 970309))).result.route,
      "onboarding",
    );
    const replacement = await linkedIdentity(sql, externalId);
    if (!replacement) throw new Error("missing_replacement_identity");
    assertNotEquals(replacement.player_id, oldPlayerId);
    assertEquals(
      (await handle(database, sink, callback(externalId, token, 970310))).result.route,
      "deletion_rejected",
    );
    assertEquals((await linkedIdentity(sql, externalId))?.player_id, replacement.player_id);
  });
});

Deno.test("a live delivery lease blocks unlink until authorization is revoked", async () => {
  await ensureRecoveryDatabase();
  await withDatabase(async (sql) => {
    const externalId = externalIdBase + 5;
    const database = new PostgresRpcDatabase(sql);
    const sink = new LocalRecoveryDeletionSink();
    await handle(database, sink, command(externalId, "/start", 974001));
    await publishFallbackDay(database, at);
    await advanceDay(database, at);
    assertEquals(
      (await handle(database, sink, callback(externalId, "nav:expedition", 974002))).result.route,
      "expedition_started",
    );
    const identity = await linkedIdentity(sql, externalId);
    if (!identity) throw new Error("missing_leased_identity");

    const lease = await database.call<{
      status: string;
      messages: Array<{ id: string; leaseId: string; playerId: string }>;
    }>("lease_outbox_v2", {
      p_worker_id: "50000000-0000-4000-8000-000000000092",
      p_limit: 20,
      p_lease_seconds: 30,
      p_at: at,
    });
    const leasedMessage = lease.messages.find((message) => message.playerId === identity.player_id);
    if (!leasedMessage) throw new Error("missing_live_lease");

    const prompt = await handle(database, sink, command(externalId, "/delete_me", 974003));
    const token = firstCallback(prompt.telegram);
    const blocked = await handle(database, sink, callback(externalId, token, 974004));
    assertEquals(blocked.result.route, "deletion_retryable");
    assertEquals((await linkedIdentity(sql, externalId))?.deletion_state, "deletion_pending");
    assertEquals(await actionableOutbox(sql, identity.player_id), { pending: 0, leased: 1 });

    assertEquals(
      await database.call("authorize_outbox_delivery_v1", {
        p_outbox_id: leasedMessage.id,
        p_lease_id: leasedMessage.leaseId,
        p_at: at,
      }),
      { status: "superseded" },
    );
    assertEquals(
      (await handle(database, sink, callback(externalId, token, 974005))).result.route,
      "deleted",
    );
    assertEquals(await linkedIdentity(sql, externalId), undefined);
    assertEquals(await actionableOutbox(sql, identity.player_id), { pending: 0, leased: 0 });

    const workerTelegram = new RecordingTelegramPort();
    const afterDeletion = await processOutboxBatch(
      dependencies(database, workerTelegram, sink),
      {
        workerId: "50000000-0000-4000-8000-000000000093",
        limit: 20,
        leaseSeconds: 30,
      },
    );
    assertEquals(afterDeletion.leased, 0);
    assertEquals(workerTelegram.calls, []);
  });
});

Deno.test("a crashed delivery lease expires against the current deletion attempt time", async () => {
  await ensureRecoveryDatabase();
  await withDatabase(async (sql) => {
    const externalId = externalIdBase + 6;
    const database = new PostgresRpcDatabase(sql);
    const sink = new LocalRecoveryDeletionSink();
    await handle(database, sink, command(externalId, "/start", 975001));
    await publishFallbackDay(database, at);
    await advanceDay(database, at);
    assertEquals(
      (await handle(database, sink, callback(externalId, "nav:expedition", 975002))).result.route,
      "expedition_started",
    );
    const identity = await linkedIdentity(sql, externalId);
    if (!identity) throw new Error("missing_expiry_identity");

    const lease = await database.call<{
      status: string;
      messages: Array<{ playerId: string }>;
    }>("lease_outbox_v2", {
      p_worker_id: "50000000-0000-4000-8000-000000000094",
      p_limit: 20,
      p_lease_seconds: 30,
      p_at: at,
    });
    assertEquals(lease.messages.some((message) => message.playerId === identity.player_id), true);

    const prompt = await handle(database, sink, command(externalId, "/delete_me", 975003));
    const token = firstCallback(prompt.telegram);
    assertEquals(
      (await handle(database, sink, callback(externalId, token, 975004))).result.route,
      "deletion_retryable",
    );

    const afterLeaseExpiry = new Date(Date.parse(at) + 31_000).toISOString();
    assertEquals(
      (await handle(
        database,
        sink,
        callback(externalId, token, 975005),
        afterLeaseExpiry,
      )).result.route,
      "deleted",
    );
    assertEquals(await linkedIdentity(sql, externalId), undefined);
  });
});

Deno.test("one-shot finalize faults converge to a deleted identity", async () => {
  await ensureRecoveryDatabase();
  await withDatabase(async (sql) => {
    const sink = new LocalRecoveryDeletionSink();
    for (
      const scenario of [
        { externalId: externalIdBase + 2, timing: "before_commit" as const, updateBase: 971000 },
        { externalId: externalIdBase + 3, timing: "after_commit" as const, updateBase: 972000 },
      ]
    ) {
      const database = new PostgresRpcDatabase(sql);
      await handle(database, sink, command(scenario.externalId, "/start", scenario.updateBase + 1));
      const identity = await linkedIdentity(sql, scenario.externalId);
      if (!identity) throw new Error("missing_fault_identity");
      const deletionId = crypto.randomUUID();
      await database.call("begin_identity_deletion_v1", {
        p_player_id: identity.player_id,
        p_deletion_id: deletionId,
      });
      const prompt = await handle(
        database,
        sink,
        command(scenario.externalId, "/delete_me", scenario.updateBase + 2),
      );
      const token = firstCallback(prompt.telegram);
      const faulted = await handle(
        new OneShotFinalizeFault(database, scenario.timing),
        sink,
        callback(scenario.externalId, token, scenario.updateBase + 3),
      );
      assertEquals(faulted.result.route, "deleted");

      const retried = await handle(
        database,
        sink,
        callback(scenario.externalId, token, scenario.updateBase + 4),
      );
      assertEquals(retried.result.route, "deleted");
      assertEquals(await linkedIdentity(sql, scenario.externalId), undefined);
      const [stored] = await withRecoveryDatabase((recovery) =>
        recovery<{ deletion_id: string; count: number }[]>`select
          min(deletion_id::text) as deletion_id, count(*)::integer as count
          from recovery.deletion_tombstones
          where surrogate_player_id = ${identity.player_id}::uuid`
      );
      assertEquals(stored, { deletion_id: deletionId, count: 1 });
    }
  });
});

Deno.test("twenty concurrent confirmations converge on one tombstone and one deleted identity", async () => {
  await ensureRecoveryDatabase();
  await withDatabase(async (sql) => {
    const externalId = externalIdBase + 4;
    const database = new PostgresRpcDatabase(sql);
    const sink = new LocalRecoveryDeletionSink();
    await handle(database, sink, command(externalId, "/start", 973001));
    const identity = await linkedIdentity(sql, externalId);
    if (!identity) throw new Error("missing_concurrent_identity");
    const prompt = await handle(database, sink, command(externalId, "/delete_me", 973002));
    const token = firstCallback(prompt.telegram);

    const results = await Promise.all(
      Array.from(
        { length: 20 },
        (_, index) => handle(database, sink, callback(externalId, token, 973100 + index)),
      ),
    );
    const routeCounts = Object.fromEntries(
      [...new Set(results.map(({ result }) => result.route))].map((route) => [
        route,
        results.filter(({ result }) => result.route === route).length,
      ]),
    );
    assertEquals(routeCounts, { deleted: 20 });
    assertEquals(await linkedIdentity(sql, externalId), undefined);
    const [stored] = await withRecoveryDatabase((recovery) =>
      recovery<{ count: number; deletion_ids: number }[]>`select
        count(*)::integer as count,
        count(distinct deletion_id)::integer as deletion_ids
        from recovery.deletion_tombstones
        where surrogate_player_id = ${identity.player_id}::uuid`
    );
    assertEquals(stored, { count: 1, deletion_ids: 1 });
  });
});
