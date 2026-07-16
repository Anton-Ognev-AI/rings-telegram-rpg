import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { RpcResult } from "./helpers/database.ts";

type Sql = Parameters<Parameters<typeof withDatabase>[0]>[0];

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

async function createUnknownFixture(
  sql: Sql,
  input: {
    readonly externalId: bigint;
    readonly at: string;
    readonly incidentId: string;
  },
) {
  const identity = await rpc(sql`
    select public.telegram_identity_v2(${input.externalId.toString()}::bigint, true) as response
  `);
  await rpc(sql`select public.publish_fallback_day_v1(${input.at}::timestamptz) as response`);
  await rpc(sql`select public.advance_day_v2(${input.at}::timestamptz) as response`);
  const started = await rpc(sql`
    select public.start_run_v3(${String(identity.playerId)}::uuid, ${input.at}::timestamptz)
      as response
  `);
  const runId = String((started.projection as { run: { id: string } }).run.id);
  const [outbox] = await sql<{ id: string }[]>`select id::text
    from game.outbox_messages
    where status = 'pending' and payload->>'runId' = ${runId}
    order by created_at desc limit 1`;
  await sql`update game.outbox_messages set
      status = 'delivery_unknown',
      leased_by = '96000000-0000-4000-8000-000000000001'::uuid,
      lease_id = ${input.incidentId}::uuid,
      lease_until = null,
      attempts = greatest(attempts, 1),
      dispatch_started_at = ${input.at}::timestamptz + interval '1 second',
      last_error_kind = 'delivery_unknown'
    where id = ${outbox.id}::uuid`;
  return {
    playerId: String(identity.playerId),
    runId,
    outboxId: outbox.id,
    incidentId: input.incidentId,
  };
}

async function reconcile(
  sql: Sql,
  input: {
    readonly outboxId: string;
    readonly incidentId: string;
    readonly decision: "confirm_delivered" | "confirm_not_delivered_and_requeue";
    readonly telegramMessageId?: bigint | null;
    readonly at: string;
  },
) {
  return await rpc(sql`select public.reconcile_delivery_unknown_v1(
    ${input.outboxId}::uuid,
    ${input.incidentId}::uuid,
    ${input.decision},
    ${input.telegramMessageId?.toString() ?? null}::bigint,
    ${input.at}::timestamptz
  ) as response`);
}

Deno.test("delivered reconciliation binds one card and exact replay is cached", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createUnknownFixture(sql, {
      externalId: 960000000000000001n,
      at: "2026-09-10T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000001",
    });
    const wrongIncident = await reconcile(sql, {
      ...fixture,
      incidentId: "96100000-0000-4000-8000-000000000099",
      decision: "confirm_delivered",
      telegramMessageId: 861000000000000001n,
      at: "2026-09-10T07:00:02Z",
    });
    assertEquals(wrongIncident, { status: "rejected", reason: "incident_mismatch" });

    const applied = await reconcile(sql, {
      ...fixture,
      decision: "confirm_delivered",
      telegramMessageId: 861000000000000001n,
      at: "2026-09-10T07:00:03Z",
    });
    assertEquals(applied, {
      status: "applied",
      outcome: "delivered",
      outboxStatus: "sent",
      repairRequired: false,
    });
    const replay = await reconcile(sql, {
      ...fixture,
      decision: "confirm_delivered",
      telegramMessageId: 861000000000000001n,
      at: "2026-09-10T07:00:04Z",
    });
    assertEquals(replay, { ...applied, status: "cached" });
    const conflict = await reconcile(sql, {
      ...fixture,
      decision: "confirm_not_delivered_and_requeue",
      telegramMessageId: null,
      at: "2026-09-10T07:00:05Z",
    });
    assertEquals(conflict, { status: "rejected", reason: "reconciliation_conflict" });

    const [state] = await sql<{
      status: string;
      cards: number;
      audits: number;
      message_id: string;
    }[]>`select o.status::text,
      (select count(*)::integer from game.telegram_run_cards c
        where c.run_id = ${fixture.runId}::uuid) as cards,
      (select count(*)::integer from game.delivery_unknown_reconciliations r
        where r.outbox_id = o.id) as audits,
      (select c.message_id::text from game.telegram_run_cards c
        where c.run_id = ${fixture.runId}::uuid) as message_id
      from game.outbox_messages o where o.id = ${fixture.outboxId}::uuid`;
    assertEquals(state, {
      status: "sent",
      cards: 1,
      audits: 1,
      message_id: "861000000000000001",
    });
  });
});

Deno.test("known not-delivered can requeue once and a new lease becomes a new incident", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createUnknownFixture(sql, {
      externalId: 960000000000000002n,
      at: "2026-09-11T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000002",
    });
    const requeued = await reconcile(sql, {
      ...fixture,
      decision: "confirm_not_delivered_and_requeue",
      telegramMessageId: null,
      at: "2026-09-11T07:00:02Z",
    });
    assertEquals(requeued, {
      status: "applied",
      outcome: "requeued",
      outboxStatus: "pending",
      repairRequired: false,
    });
    const [cleared] = await sql<{
      status: string;
      lease_id: string | null;
      dispatch_started_at: string | null;
    }[]>`select status::text, lease_id::text, dispatch_started_at::text
      from game.outbox_messages where id = ${fixture.outboxId}::uuid`;
    assertEquals(cleared, { status: "pending", lease_id: null, dispatch_started_at: null });

    const leased = await rpc(sql`select public.lease_outbox_v3(
      '96200000-0000-4000-8000-000000000001'::uuid,
      50, 30, '2026-09-11T07:00:03Z'::timestamptz
    ) as response`);
    const message = (leased.messages as Array<Record<string, unknown>>).find((candidate) =>
      String(candidate.id) === fixture.outboxId
    )!;
    const secondIncident = String(message.leaseId);
    assertEquals(secondIncident === fixture.incidentId, false);
    const authorized = await rpc(sql`select public.authorize_outbox_delivery_v2(
      ${fixture.outboxId}::uuid, ${secondIncident}::uuid, true, 5,
      '2026-09-11T07:00:04Z'::timestamptz
    ) as response`);
    assertEquals(authorized.status, "ok");
    await rpc(sql`select public.lease_outbox_v3(
      '96200000-0000-4000-8000-000000000002'::uuid,
      50, 30, '2026-09-11T07:00:10Z'::timestamptz
    ) as response`);

    const delivered = await reconcile(sql, {
      outboxId: fixture.outboxId,
      incidentId: secondIncident,
      decision: "confirm_delivered",
      telegramMessageId: 861000000000000002n,
      at: "2026-09-11T07:00:11Z",
    });
    assertEquals(delivered.outcome, "delivered");
    const [audit] = await sql<{ incidents: number }[]>`select count(*)::integer as incidents
      from game.delivery_unknown_reconciliations
      where outbox_id = ${fixture.outboxId}::uuid`;
    assertEquals(audit.incidents, 2);
  });
});

Deno.test("deleted, stale, or already-bound incidents are superseded and never requeued", async () => {
  await withDatabase(async (sql) => {
    const deleted = await createUnknownFixture(sql, {
      externalId: 960000000000000003n,
      at: "2026-09-12T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000003",
    });
    const stale = await createUnknownFixture(sql, {
      externalId: 960000000000000004n,
      at: "2026-09-13T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000004",
    });
    const bound = await createUnknownFixture(sql, {
      externalId: 960000000000000005n,
      at: "2026-09-14T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000005",
    });
    await rpc(sql`select public.begin_identity_deletion_v2(
      ${deleted.playerId}::uuid,
      '96300000-0000-4000-8000-000000000001'::uuid,
      '2026-09-14T07:00:02Z'::timestamptz
    ) as response`);
    await sql`update game.runs set state_version = state_version + 1
      where id = ${stale.runId}::uuid`;
    await sql`insert into game.telegram_run_cards(
      run_id, player_id, message_id, last_state_version
    ) values (${bound.runId}::uuid, ${bound.playerId}::uuid, 861000000000000005, 0)`;

    for (
      const [fixture, at] of [
        [deleted, "2026-09-14T07:00:03Z"],
        [stale, "2026-09-14T07:00:04Z"],
        [bound, "2026-09-14T07:00:05Z"],
      ] as const
    ) {
      const result = await reconcile(sql, {
        ...fixture,
        decision: "confirm_not_delivered_and_requeue",
        telegramMessageId: null,
        at,
      });
      assertEquals(result.outcome, "superseded");
      assertEquals(result.outboxStatus, "sent");
    }
    const [state] = await sql<{ sent: number; pending: number }[]>`select
      count(*) filter (where status = 'sent' and last_error_kind = 'superseded')::integer as sent,
      count(*) filter (where status = 'pending')::integer as pending
      from game.outbox_messages
      where id in (${deleted.outboxId}::uuid, ${stale.outboxId}::uuid, ${bound.outboxId}::uuid)`;
    assertEquals(state, { sent: 3, pending: 0 });
  });
});

Deno.test("concurrent conflicting operator decisions persist exactly one result", async () => {
  const fixture = await withDatabase((sql) =>
    createUnknownFixture(sql, {
      externalId: 960000000000000006n,
      at: "2026-09-15T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000006",
    })
  );
  const results = await Promise.all([
    withDatabase((sql) =>
      reconcile(sql, {
        ...fixture,
        decision: "confirm_delivered",
        telegramMessageId: 861000000000000006n,
        at: "2026-09-15T07:00:02Z",
      })
    ),
    withDatabase((sql) =>
      reconcile(sql, {
        ...fixture,
        decision: "confirm_not_delivered_and_requeue",
        telegramMessageId: null,
        at: "2026-09-15T07:00:02Z",
      })
    ),
  ]);
  assertEquals(results.filter((value) => value.status === "applied").length, 1);
  assertEquals(results.filter((value) => value.reason === "reconciliation_conflict").length, 1);
  await withDatabase(async (sql) => {
    const [state] = await sql<{ audits: number }[]>`select count(*)::integer as audits
      from game.delivery_unknown_reconciliations
      where outbox_id = ${fixture.outboxId}::uuid`;
    assertEquals(state.audits, 1);
  });
});

Deno.test("identity deletion racing a requeue always leaves delivery suppressed", async () => {
  const fixture = await withDatabase((sql) =>
    createUnknownFixture(sql, {
      externalId: 960000000000000007n,
      at: "2026-09-16T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000007",
    })
  );
  const [deletion, reconciliation] = await Promise.all([
    withDatabase((sql) =>
      rpc(sql`select public.begin_identity_deletion_v2(
        ${fixture.playerId}::uuid,
        '96300000-0000-4000-8000-000000000007'::uuid,
        '2026-09-16T07:00:02Z'::timestamptz
      ) as response`)
    ),
    withDatabase((sql) =>
      reconcile(sql, {
        ...fixture,
        decision: "confirm_not_delivered_and_requeue",
        telegramMessageId: null,
        at: "2026-09-16T07:00:02Z",
      })
    ),
  ]);
  assertEquals(["applied", "cached"].includes(String(deletion.status)), true);
  assertEquals(reconciliation.status, "applied");
  await withDatabase(async (sql) => {
    const [state] = await sql<{
      player_state: string;
      outbox_status: string;
      last_error_kind: string;
      audits: number;
    }[]>`select p.deletion_state::text as player_state,
      o.status::text as outbox_status,
      o.last_error_kind,
      (select count(*)::integer from game.delivery_unknown_reconciliations r
        where r.outbox_id = o.id) as audits
      from game.players p
      join game.runs r on r.player_id = p.id
      join game.outbox_messages o on o.payload->>'runId' = r.id::text
      where p.id = ${fixture.playerId}::uuid and o.id = ${fixture.outboxId}::uuid`;
    assertEquals(state, {
      player_state: "deletion_pending",
      outbox_status: "sent",
      last_error_kind: "superseded",
      audits: 1,
    });
  });
});

Deno.test("a delivered stale incident binds its real card and requests one repair", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createUnknownFixture(sql, {
      externalId: 960000000000000008n,
      at: "2026-09-17T07:00:00Z",
      incidentId: "96100000-0000-4000-8000-000000000008",
    });
    await sql`update game.runs set state_version = 1, stage = 2
      where id = ${fixture.runId}::uuid`;
    const delivered = await reconcile(sql, {
      ...fixture,
      decision: "confirm_delivered",
      telegramMessageId: 861000000000000008n,
      at: "2026-09-17T07:00:02Z",
    });
    assertEquals(delivered, {
      status: "applied",
      outcome: "superseded",
      outboxStatus: "sent",
      repairRequired: true,
    });
    const repair = await rpc(sql`select public.request_run_render_v2(
      ${fixture.playerId}::uuid, ${fixture.runId}::uuid
    ) as response`);
    assertEquals(repair.status, "applied");
    const [state] = await sql<{ cards: number; repairs: number }[]>`select
      (select count(*)::integer from game.telegram_run_cards
        where run_id = ${fixture.runId}::uuid) as cards,
      (select count(*)::integer from game.outbox_messages
        where intent_type = 'repair_run_state'
          and status = 'pending'
          and payload->>'runId' = ${fixture.runId}) as repairs`;
    assertEquals(state, { cards: 1, repairs: 1 });
  });
});
