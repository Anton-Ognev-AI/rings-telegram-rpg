import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";

interface RpcResult {
  readonly status: string;
  readonly [key: string]: unknown;
}

async function rpc(
  _sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  statement: PromiseLike<ReadonlyArray<unknown>>,
): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

async function createQueuedRun(
  sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  externalId: bigint,
  at: string,
): Promise<{ playerId: string; runId: string }> {
  const identity = await rpc(
    sql,
    sql`
    select public.telegram_identity_v1(${externalId.toString()}::bigint, true) as response
  `,
  );
  await rpc(sql, sql`select public.publish_fallback_day_v1(${at}::timestamptz) as response`);
  await rpc(sql, sql`select public.advance_day_v1(${at}::timestamptz) as response`);
  const playerId = String(identity.playerId);
  const started = await rpc(
    sql,
    sql`
    select public.start_run_v2(
      ${playerId}::uuid, ${at}::timestamptz,
      ${
      sql.json({
        maxHp: 80,
        physical: 30,
        magical: 30,
        agility: 30,
        vitality: 30,
        defense: 20,
        vampRateBps: 0,
        postHeal: 0,
      })
    }::jsonb,
      ${"c".repeat(64)}, ${sql.json({ items: [], rings: [] })}::jsonb, ${"d".repeat(64)}
    ) as response
  `,
  );
  return {
    playerId,
    runId: (started.projection as { run: { id: string } }).run.id,
  };
}

Deno.test("outbox lease and sent completion are owner-bound and idempotent", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createQueuedRun(
      sql,
      920000000000000001n,
      "2026-08-16T07:00:00Z",
    );
    const worker = "93000000-0000-4000-8000-000000000001";
    const invalidLease = await rpc(
      sql,
      sql`
        select public.lease_outbox_v1(
          ${worker}::uuid, null::integer, 30, '2026-08-16T07:00:01Z'::timestamptz
        ) as response
      `,
    );
    assertEquals(invalidLease.status, "rejected");
    assertEquals(invalidLease.reason, "invalid_lease_request");

    const leased = await rpc(
      sql,
      sql`
      select public.lease_outbox_v1(
        ${worker}::uuid, 50, 30, '2026-08-16T07:00:01Z'::timestamptz
      ) as response
    `,
    );
    assertEquals(leased.status, "ok");
    const messages = leased.messages as Array<Record<string, unknown>>;
    assertEquals(messages.length >= 1, true);
    const message = messages.find((candidate) =>
      (candidate.payload as { runId: string }).runId === fixture.runId
    )!;
    assertNotEquals(message.leaseId, null);
    assertEquals(message.telegramExternalId, "920000000000000001");

    const invalidCompletion = await rpc(
      sql,
      sql`
        select public.complete_outbox_v1(
          ${String(message.id)}::uuid,
          ${String(message.leaseId)}::uuid,
          null::text, null, null,
          '2026-08-16T07:00:02Z'::timestamptz
        ) as response
      `,
    );
    assertEquals(invalidCompletion.status, "rejected");
    assertEquals(invalidCompletion.reason, "invalid_completion");

    const wrongLease = await rpc(
      sql,
      sql`
        select public.complete_outbox_v1(
          ${String(message.id)}::uuid,
          '94000000-0000-4000-8000-000000000001'::uuid,
          'sent', 880000000000000001::bigint, null,
          '2026-08-16T07:00:02Z'::timestamptz
        ) as response
      `,
    );
    assertEquals(wrongLease.status, "rejected");
    assertEquals(wrongLease.reason, "lease_mismatch");

    const completed = await rpc(
      sql,
      sql`
      select public.complete_outbox_v1(
        ${String(message.id)}::uuid,
        ${String(message.leaseId)}::uuid,
        'sent', 880000000000000001::bigint, null,
        '2026-08-16T07:00:02Z'::timestamptz
      ) as response
    `,
    );
    assertEquals(completed.status, "applied");
    const replay = await rpc(
      sql,
      sql`
      select public.complete_outbox_v1(
        ${String(message.id)}::uuid,
        ${String(message.leaseId)}::uuid,
        'sent', 880000000000000001::bigint, null,
        '2026-08-16T07:00:03Z'::timestamptz
      ) as response
    `,
    );
    assertEquals(replay.status, "cached");

    const conflictingReplay = await rpc(
      sql,
      sql`
        select public.complete_outbox_v1(
          ${String(message.id)}::uuid,
          ${String(message.leaseId)}::uuid,
          'sent', 880000000000000002::bigint, null,
          '2026-08-16T07:00:04Z'::timestamptz
        ) as response
      `,
    );
    assertEquals(conflictingReplay.status, "rejected");
    assertEquals(conflictingReplay.reason, "message_id_conflict");

    const [state] = await sql<{ status: string; cards: number; message_id: string }[]>`
      select o.status::text,
        (select count(*)::integer from game.telegram_run_cards where run_id = ${fixture.runId}::uuid)
          as cards,
        (select message_id::text from game.telegram_run_cards where run_id = ${fixture.runId}::uuid)
          as message_id
      from game.outbox_messages o where o.id = ${String(message.id)}::uuid
    `;
    assertEquals(state, { status: "sent", cards: 1, message_id: "880000000000000001" });
  });
});

Deno.test("retry can be reclaimed while delivery unknown cannot be blindly resent", async () => {
  await withDatabase(async (sql) => {
    const retryRun = await createQueuedRun(
      sql,
      920000000000000002n,
      "2026-08-17T07:00:00Z",
    );
    const unknownRun = await createQueuedRun(
      sql,
      920000000000000003n,
      "2026-08-18T07:00:00Z",
    );
    const worker = "93000000-0000-4000-8000-000000000002";
    const firstLease = await rpc(
      sql,
      sql`
      select public.lease_outbox_v1(
        ${worker}::uuid, 50, 30, '2026-08-18T07:00:01Z'::timestamptz
      ) as response
    `,
    );
    const messages = firstLease.messages as Array<Record<string, unknown>>;
    const retryMessage = messages.find((candidate) =>
      (candidate.payload as { runId: string }).runId === retryRun.runId
    )!;
    const unknownMessage = messages.find((candidate) =>
      (candidate.payload as { runId: string }).runId === unknownRun.runId
    )!;

    const retried = await rpc(
      sql,
      sql`
      select public.complete_outbox_v1(
        ${String(retryMessage.id)}::uuid, ${String(retryMessage.leaseId)}::uuid,
        'retry', null, '2026-08-18T07:01:00Z'::timestamptz,
        '2026-08-18T07:00:02Z'::timestamptz
      ) as response
    `,
    );
    assertEquals(retried.status, "applied");
    const unknown = await rpc(
      sql,
      sql`
      select public.complete_outbox_v1(
        ${String(unknownMessage.id)}::uuid, ${String(unknownMessage.leaseId)}::uuid,
        'delivery_unknown', null, null, '2026-08-18T07:00:02Z'::timestamptz
      ) as response
    `,
    );
    assertEquals(unknown.status, "applied");

    const secondLease = await rpc(
      sql,
      sql`
      select public.lease_outbox_v1(
        ${worker}::uuid, 50, 30, '2026-08-18T07:01:00Z'::timestamptz
      ) as response
    `,
    );
    const secondRunIds = (secondLease.messages as Array<{ payload: { runId: string } }>)
      .map((message) => message.payload.runId);
    assertEquals(secondRunIds.includes(retryRun.runId), true);
    assertEquals(secondRunIds.includes(unknownRun.runId), false);
  });
});

Deno.test("concurrent workers never lease the same outbox message twice", async () => {
  const fixtures = await withDatabase(async (sql) => {
    return await Promise.all([
      createQueuedRun(sql, 920000000000000004n, "2026-08-21T07:00:00Z"),
      createQueuedRun(sql, 920000000000000005n, "2026-08-21T07:00:00Z"),
    ]);
  });
  const targetRunIds = new Set(fixtures.map((fixture) => fixture.runId));

  const leases = await Promise.all(
    [
      "93000000-0000-4000-8000-000000000003",
      "93000000-0000-4000-8000-000000000004",
    ].map((worker) =>
      withDatabase(async (sql) => {
        return await rpc(
          sql,
          sql`
            select public.lease_outbox_v1(
              ${worker}::uuid, 50, 30, '2026-08-21T07:00:01Z'::timestamptz
            ) as response
          `,
        );
      })
    ),
  );
  const messages = leases.flatMap((lease) => lease.messages as Array<Record<string, unknown>>);
  const ids = messages.map((message) => String(message.id));
  assertEquals(new Set(ids).size, ids.length);
  const leasedTargetRuns = messages
    .map((message) => String((message.payload as { runId: string }).runId))
    .filter((runId) => targetRunIds.has(runId));
  assertEquals(new Set(leasedTargetRuns), targetRunIds);
});

Deno.test("lease supersedes stale run state and returns only the canonical state", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createQueuedRun(
      sql,
      920000000000000006n,
      "2026-08-22T07:00:00Z",
    );
    await sql.begin(async (transaction) => {
      await transaction`
        update game.runs set state_version = 1 where id = ${fixture.runId}::uuid
      `;
      await transaction`
        insert into game.outbox_messages(logical_key, intent_type, payload)
        values (
          ${`run:${fixture.runId}:state:1`},
          'render_run_state',
          ${transaction.json({ runId: fixture.runId, stateVersion: 1 })}::jsonb
        )
      `;
    });

    const leased = await rpc(
      sql,
      sql`
        select public.lease_outbox_v1(
          '93000000-0000-4000-8000-000000000005'::uuid,
          50, 30, '2026-08-22T07:00:01Z'::timestamptz
        ) as response
      `,
    );
    const states = (leased.messages as Array<{ payload: { runId: string; stateVersion: number } }>)
      .filter((message) => message.payload.runId === fixture.runId)
      .map((message) => message.payload.stateVersion);
    assertEquals(states, [1]);

    const [stale] = await sql<{ status: string; error_kind: string }[]>`
      select status::text, last_error_kind as error_kind
      from game.outbox_messages
      where logical_key = ${`run:${fixture.runId}:state:0`}
    `;
    assertEquals(stale, { status: "sent", error_kind: "superseded" });
  });
});

Deno.test("an expired lease is reclaimed with a new lease ID", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createQueuedRun(
      sql,
      920000000000000007n,
      "2026-08-23T07:00:00Z",
    );
    const first = await rpc(
      sql,
      sql`
        select public.lease_outbox_v1(
          '93000000-0000-4000-8000-000000000006'::uuid,
          50, 5, '2026-08-23T07:00:01Z'::timestamptz
        ) as response
      `,
    );
    const firstMessage = (first.messages as Array<Record<string, unknown>>).find((message) =>
      (message.payload as { runId: string }).runId === fixture.runId
    )!;
    const second = await rpc(
      sql,
      sql`
        select public.lease_outbox_v1(
          '93000000-0000-4000-8000-000000000007'::uuid,
          50, 5, '2026-08-23T07:00:06Z'::timestamptz
        ) as response
      `,
    );
    const secondMessage = (second.messages as Array<Record<string, unknown>>).find((message) =>
      (message.payload as { runId: string }).runId === fixture.runId
    )!;
    assertNotEquals(firstMessage.leaseId, secondMessage.leaseId);
    assertEquals(secondMessage.attempts, 2);
  });
});

Deno.test("retry budget stops at ten attempts", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createQueuedRun(
      sql,
      920000000000000008n,
      "2026-08-24T07:00:00Z",
    );
    const worker = "93000000-0000-4000-8000-000000000008";
    let finalStatus = "";

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const minute = String(attempt - 1).padStart(2, "0");
      const at = `2026-08-24T07:${minute}:00Z`;
      const retryAt = `2026-08-24T07:${minute}:01Z`;
      const leased = await rpc(
        sql,
        sql`
          select public.lease_outbox_v1(
            ${worker}::uuid, 50, 30, ${at}::timestamptz
          ) as response
        `,
      );
      const message = (leased.messages as Array<Record<string, unknown>>).find((candidate) =>
        (candidate.payload as { runId: string }).runId === fixture.runId
      )!;
      const completed = await rpc(
        sql,
        sql`
          select public.complete_outbox_v1(
            ${String(message.id)}::uuid, ${String(message.leaseId)}::uuid,
            'retry', null, ${retryAt}::timestamptz, ${at}::timestamptz
          ) as response
        `,
      );
      finalStatus = String(completed.outboxStatus);
    }

    assertEquals(finalStatus, "dead");
    const [state] = await sql<{ status: string; attempts: number }[]>`
      select status::text, attempts
      from game.outbox_messages
      where logical_key = ${`run:${fixture.runId}:state:0`}
    `;
    assertEquals(state, { status: "dead", attempts: 10 });
  });
});
