import { assertEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";

interface RpcResult {
  readonly status: string;
  readonly [key: string]: unknown;
}

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>): Promise<RpcResult> {
  const [row] = await statement;
  return (row as { response: RpcResult }).response;
}

Deno.test("concurrent render requests coalesce to one actionable repair", async () => {
  const fixture = await withDatabase(async (sql) => {
    const at = "2026-09-20T07:00:00Z";
    const identity = await rpc(sql`
      select public.telegram_identity_v1(930000000000000001::bigint, true) as response
    `);
    await rpc(sql`select public.publish_fallback_day_v1(${at}::timestamptz) as response`);
    await rpc(sql`select public.advance_day_v1(${at}::timestamptz) as response`);
    const playerId = String(identity.playerId);
    const started = await rpc(sql`
      select public.start_run_v2(
        ${playerId}::uuid,
        ${at}::timestamptz,
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
        ${"a".repeat(64)},
        ${sql.json({ partyMode: "solo", companion: null, items: [], rings: [] })}::jsonb,
        ${"b".repeat(64)}
      ) as response
    `);
    const runId = String((started.projection as { run: { id: string } }).run.id);
    const leased = await rpc(sql`
      select public.lease_outbox_v1(
        '95000000-0000-4000-8000-000000000001'::uuid,
        10,
        30,
        '2026-09-20T07:00:01Z'::timestamptz
      ) as response
    `);
    const initial = (leased.messages as Array<Record<string, unknown>>).find((message) =>
      (message.payload as { runId: string }).runId === runId
    );
    if (!initial) throw new Error("missing_initial_render");
    const completed = await rpc(sql`
      select public.complete_outbox_v1(
        ${String(initial.id)}::uuid,
        ${String(initial.leaseId)}::uuid,
        'sent',
        990001::bigint,
        null,
        '2026-09-20T07:00:02Z'::timestamptz
      ) as response
    `);
    assertEquals(completed.status, "applied");
    return { playerId, runId };
  });

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      withDatabase(async (sql) => {
        return await rpc(sql`
          select public.request_run_render_v1(
            ${fixture.playerId}::uuid,
            ${fixture.runId}::uuid,
            ${String(960000000000000001n + BigInt(index))}
          ) as response
        `);
      })),
  );

  assertEquals(results.filter((result) => result.status === "applied").length, 1);
  assertEquals(results.filter((result) => result.status === "cached").length, 19);
  await withDatabase(async (sql) => {
    const [state] = await sql<{ actionable: number; total: number }[]>`
      select
        count(*) filter (where status in ('pending', 'leased'))::integer as actionable,
        count(*)::integer as total
      from game.outbox_messages
      where intent_type = 'repair_run_state'
        and payload->>'runId' = ${fixture.runId}
    `;
    assertEquals(state, { actionable: 1, total: 1 });
  });
});
