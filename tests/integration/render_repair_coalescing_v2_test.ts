import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";
import type { RpcResult } from "./helpers/database.ts";

async function rpc(
  statement: PromiseLike<ReadonlyArray<unknown>>,
): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

async function createCardFixture(
  sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  externalId: bigint,
  at: string,
) {
  const identity = await rpc(sql`
    select public.telegram_identity_v2(${externalId.toString()}::bigint, true) as response
  `);
  await rpc(sql`select public.publish_fallback_day_v1(${at}::timestamptz) as response`);
  await rpc(sql`select public.advance_day_v2(${at}::timestamptz) as response`);
  const started = await rpc(sql`
    select public.start_run_v3(${String(identity.playerId)}::uuid, ${at}::timestamptz) as response
  `);
  const runId = String((started.projection as { run: { id: string } }).run.id);
  await sql`update game.outbox_messages set status = 'sent'
    where payload->>'runId' = ${runId}`;
  await sql`insert into game.telegram_run_cards(
    run_id, player_id, message_id, last_state_version
  ) values (${runId}::uuid, ${
    String(identity.playerId)
  }::uuid, ${externalId.toString()}::bigint, 0)`;
  return { playerId: String(identity.playerId), runId };
}

Deno.test("render v2 caches a card that already represents the current state", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createCardFixture(
      sql,
      950000000000000001n,
      "2026-09-01T07:00:00Z",
    );

    const response = await rpc(sql`select public.request_run_render_v2(
      ${fixture.playerId}::uuid, ${fixture.runId}::uuid
    ) as response`);
    assertEquals(response, {
      status: "cached",
      reason: "card_current",
      runId: fixture.runId,
      stateVersion: 0,
    });
    const [state] = await sql<{ repairs: number }[]>`select count(*)::integer as repairs
      from game.outbox_messages
      where intent_type = 'repair_run_state'
        and payload->>'runId' = ${fixture.runId}`;
    assertEquals(state.repairs, 0);
  });
});

Deno.test("render v2 coalesces one repair for a stale card", async () => {
  await withDatabase(async (sql) => {
    const fixture = await createCardFixture(
      sql,
      950000000000000002n,
      "2026-09-02T07:00:00Z",
    );
    await sql`update game.runs set state_version = 1, stage = 2
      where id = ${fixture.runId}::uuid`;

    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        rpc(sql`select public.request_run_render_v2(
        ${fixture.playerId}::uuid, ${fixture.runId}::uuid
      ) as response`)),
    );
    assertEquals(responses.filter((value) => value.status === "applied").length, 1);
    assertEquals(responses.filter((value) => value.status === "cached").length, 24);
    const [state] = await sql<{ repairs: number }[]>`select count(*)::integer as repairs
      from game.outbox_messages
      where intent_type = 'repair_run_state'
        and status = 'pending'
        and payload->>'runId' = ${fixture.runId}
        and payload->>'stateVersion' = '1'`;
    assertEquals(state.repairs, 1);
  });
});
