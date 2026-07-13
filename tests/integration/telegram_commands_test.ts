import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import { withDatabase } from "../../scripts/db/local-database.ts";

interface RpcResult {
  readonly status: string;
  readonly [key: string]: unknown;
}

const SNAPSHOT = {
  maxHp: 80,
  physical: 30,
  magical: 30,
  agility: 30,
  vitality: 30,
  defense: 20,
  vampRateBps: 0,
  postHeal: 0,
};

async function call<T extends RpcResult>(
  _sql: Parameters<Parameters<typeof withDatabase>[0]>[0],
  statement: PromiseLike<ReadonlyArray<unknown>>,
): Promise<T> {
  const [row] = await statement;
  return (row as { response: T }).response;
}

Deno.test("Telegram identity bootstrap is minimal, idempotent, and concurrency safe", async () => {
  const telegramId = 910000000000000001n;
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      withDatabase(async (sql) => {
        const [row] = await sql<{ response: RpcResult }[]>`
          select public.telegram_identity_v1(${telegramId.toString()}::bigint, true) as response
        `;
        return row.response;
      })),
  );

  const playerIds = new Set(responses.map((result) => String(result.playerId)));
  assertEquals(playerIds.size, 1);
  assertEquals(responses.filter((result) => result.created === true).length, 1);
  assertEquals(responses.every((result) => result.status === "ok"), true);

  await withDatabase(async (sql) => {
    const [counts] = await sql<
      { players: number; links: number; stats: number; accounts: number }[]
    >`
      select
        count(distinct p.id)::integer as players,
        count(distinct il.id)::integer as links,
        count(distinct ps.player_id)::integer as stats,
        count(distinct xa.player_id)::integer as accounts
      from game.players p
      join game.identity_links il on il.player_id = p.id
      join game.player_stats ps on ps.player_id = p.id
      join game.xp_accounts xa on xa.player_id = p.id
      where il.external_id = ${telegramId.toString()}::bigint
    `;
    assertEquals(counts, { players: 1, links: 1, stats: 1, accounts: 1 });

    const [link] = await sql<{ username: string | null }[]>`
      select username from game.identity_links where external_id = ${telegramId.toString()}::bigint
    `;
    assertEquals(link.username, null);

    const unknown = await call<RpcResult>(
      sql,
      sql`
      select public.telegram_identity_v1(910000000000000099::bigint, false) as response
    `,
    );
    assertEquals(unknown.status, "none");
  });
});

Deno.test("Telegram identity bootstrap rejects a nullable creation mode", async () => {
  await withDatabase(async (sql) => {
    const response = await call<RpcResult>(
      sql,
      sql`
        select public.telegram_identity_v1(
          910000000000000098::bigint, null::boolean
        ) as response
      `,
    );
    assertEquals(response.status, "rejected");
    assertEquals(response.reason, "invalid_create_mode");
  });
});

Deno.test("V2 start atomically creates one run, one initial outbox, and an owner-bound view", async () => {
  await withDatabase(async (sql) => {
    const identity = await call<RpcResult>(
      sql,
      sql`
      select public.telegram_identity_v1(910000000000000002::bigint, true) as response
    `,
    );
    const playerId = String(identity.playerId);
    const published = await call<RpcResult>(
      sql,
      sql`
      select public.publish_fallback_day_v1('2026-08-15T07:00:00Z'::timestamptz) as response
    `,
    );
    assertEquals(published.status, "applied");
    const advanced = await call<RpcResult>(
      sql,
      sql`
      select public.advance_day_v1('2026-08-15T07:00:00Z'::timestamptz) as response
    `,
    );
    assertEquals(advanced.status, "ok");

    const start = await call<RpcResult>(
      sql,
      sql`
      select public.start_run_v2(
        ${playerId}::uuid,
        '2026-08-15T07:00:00Z'::timestamptz,
        ${sql.json(SNAPSHOT)}::jsonb,
        ${"a".repeat(64)},
        ${sql.json({ items: [], rings: [] })}::jsonb,
        ${"b".repeat(64)}
      ) as response
    `,
    );
    assertEquals(start.status, "applied");
    const projection = start.projection as { run: { id: string; stage: number } };
    const runId = projection.run.id;
    assertEquals(projection.run.stage, 1);

    const replay = await call<RpcResult>(
      sql,
      sql`
      select public.start_run_v2(
        ${playerId}::uuid,
        '2026-08-15T07:01:00Z'::timestamptz,
        ${sql.json(SNAPSHOT)}::jsonb,
        ${"a".repeat(64)},
        ${sql.json({ items: [], rings: [] })}::jsonb,
        ${"b".repeat(64)}
      ) as response
    `,
    );
    assertEquals(replay.status, "cached");

    const [effects] = await sql<{ runs: number; outbox: number }[]>`
      select
        (select count(*)::integer from game.runs where player_id = ${playerId}::uuid) as runs,
        (select count(*)::integer from game.outbox_messages
          where logical_key = ${`run:${runId}:state:0`}) as outbox
    `;
    assertEquals(effects, { runs: 1, outbox: 1 });

    const view = await call<RpcResult>(
      sql,
      sql`
      select public.run_view_v1(${playerId}::uuid, ${runId}::uuid) as response
    `,
    );
    assertEquals(view.status, "ok");
    assertEquals((view.content as { schemaVersion: string }).schemaVersion, "dungeon-v1");
    assertEquals((view.run as { id: string }).id, runId);
    assertNotEquals(view.cycle, null);

    const other = await call<RpcResult>(
      sql,
      sql`
      select public.telegram_identity_v1(910000000000000003::bigint, true) as response
    `,
    );
    const foreign = await call<RpcResult>(
      sql,
      sql`
      select public.run_view_v1(${String(other.playerId)}::uuid, ${runId}::uuid) as response
    `,
    );
    assertEquals(foreign.status, "rejected");
    assertEquals(foreign.reason, "actor_mismatch");
  });
});

Deno.test("Kyiv publication uses adjacent 09:00 boundaries", async () => {
  await withDatabase(async (sql) => {
    for (
      const sample of [
        { at: "2026-03-28T07:00:00Z", hours: 23 },
        { at: "2026-10-24T06:00:00Z", hours: 25 },
      ]
    ) {
      const response = await call<RpcResult>(
        sql,
        sql`
        select public.publish_fallback_day_v1(${sample.at}::timestamptz) as response
      `,
      );
      const cycleId = String(response.cycleId);
      const [day] = await sql<{ span_hours: number; grace_hours: number }[]>`
        select
          extract(epoch from (closes_at - opens_at))::integer / 3600 as span_hours,
          extract(epoch from (grace_ends_at - closes_at))::integer / 3600 as grace_hours
        from game.dungeon_days where cycle_id = ${cycleId}::date
      `;
      assertEquals(day.span_hours, sample.hours);
      assertEquals(day.grace_hours, 2);
    }
  });
});

Deno.test("an old run blocks the next cycle during grace, then expires and can be abandoned", async () => {
  await withDatabase(async (sql) => {
    const identity = await call<RpcResult>(
      sql,
      sql`
        select public.telegram_identity_v1(910000000000000004::bigint, true) as response
      `,
    );
    const playerId = String(identity.playerId);
    await call<RpcResult>(
      sql,
      sql`select public.publish_fallback_day_v1('2026-08-19T06:00:00Z'::timestamptz) as response`,
    );
    await call<RpcResult>(
      sql,
      sql`select public.advance_day_v1('2026-08-19T06:00:00Z'::timestamptz) as response`,
    );

    const first = await call<RpcResult>(
      sql,
      sql`
        select public.start_run_v2(
          ${playerId}::uuid, '2026-08-19T06:00:00Z'::timestamptz,
          ${sql.json(SNAPSHOT)}::jsonb, ${"e".repeat(64)},
          ${sql.json({ items: [], rings: [] })}::jsonb, ${"f".repeat(64)}
        ) as response
      `,
    );
    const firstRunId = (first.projection as { run: { id: string } }).run.id;

    await call<RpcResult>(
      sql,
      sql`select public.publish_fallback_day_v1('2026-08-20T06:00:00Z'::timestamptz) as response`,
    );
    await call<RpcResult>(
      sql,
      sql`select public.advance_day_v1('2026-08-20T06:00:00Z'::timestamptz) as response`,
    );

    const duringGrace = await call<RpcResult>(
      sql,
      sql`
        select public.start_run_v2(
          ${playerId}::uuid, '2026-08-20T07:00:00Z'::timestamptz,
          ${sql.json(SNAPSHOT)}::jsonb, ${"e".repeat(64)},
          ${sql.json({ items: [], rings: [] })}::jsonb, ${"f".repeat(64)}
        ) as response
      `,
    );
    assertEquals(duringGrace.status, "rejected");
    assertEquals(duringGrace.reason, "old_run_active");

    const advanced = await call<RpcResult>(
      sql,
      sql`select public.advance_day_v1('2026-08-20T08:00:00Z'::timestamptz) as response`,
    );
    assertEquals(advanced.runsExpired, 1);

    const second = await call<RpcResult>(
      sql,
      sql`
        select public.start_run_v2(
          ${playerId}::uuid, '2026-08-20T08:00:00Z'::timestamptz,
          ${sql.json(SNAPSHOT)}::jsonb, ${"e".repeat(64)},
          ${sql.json({ items: [], rings: [] })}::jsonb, ${"f".repeat(64)}
        ) as response
      `,
    );
    assertEquals(second.status, "applied");
    const secondRunId = (second.projection as { run: { id: string } }).run.id;
    assertNotEquals(firstRunId, secondRunId);

    const abandoned = await call<RpcResult>(
      sql,
      sql`select public.abandon_run_v1(${playerId}::uuid, ${secondRunId}::uuid) as response`,
    );
    assertEquals(abandoned.status, "applied");
    const replay = await call<RpcResult>(
      sql,
      sql`select public.abandon_run_v1(${playerId}::uuid, ${secondRunId}::uuid) as response`,
    );
    assertEquals(replay.status, "cached");

    const [statuses] = await sql<{ first_status: string; second_status: string }[]>`
      select
        (select status::text from game.runs where id = ${firstRunId}::uuid) as first_status,
        (select status::text from game.runs where id = ${secondRunId}::uuid) as second_status
    `;
    assertEquals(statuses, { first_status: "expired", second_status: "abandoned" });
  });
});
