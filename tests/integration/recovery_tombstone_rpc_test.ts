import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  ensureRecoveryDatabase,
  withRecoveryDatabase,
} from "../../scripts/recovery/local-recovery-database.ts";

const playerId = "60000000-0000-4000-8000-000000000082";
const otherPlayerId = "60000000-0000-4000-8000-000000000083";
const deletionId = "61000000-0000-5000-8000-000000000082";
const recordedAt = "2026-07-16T12:05:00.000Z";

Deno.test("recovery RPC is idempotent, conflict-safe and service-role-only", async () => {
  await ensureRecoveryDatabase();
  await withRecoveryDatabase(async (sql) => {
    await sql`delete from recovery.deletion_tombstones
      where surrogate_player_id in (${playerId}::uuid, ${otherPlayerId}::uuid)
        or deletion_id = ${deletionId}::uuid`;
    try {
      const call = async (player: string, deletion: string, at: string) => {
        const [row] = await sql<{ result: { status: string; reason?: string } }[]>`
          select public.record_deletion_tombstone_v1(
            ${player}::uuid, ${deletion}::uuid, ${at}::timestamptz
          ) as result`;
        return row.result;
      };

      assertEquals(await call(playerId, deletionId, recordedAt), { status: "applied" });
      assertEquals(await call(playerId, deletionId, recordedAt), { status: "cached" });
      assertEquals(await call(otherPlayerId, deletionId, recordedAt), {
        status: "rejected",
        reason: "tombstone_conflict",
      });
      assertEquals(await call(playerId, deletionId, "2026-07-16T12:05:01.000Z"), {
        status: "rejected",
        reason: "tombstone_conflict",
      });

      const [stored] = await sql<{ count: number; fields: number }[]>`
        select count(*)::integer as count,
          (select count(*)::integer from information_schema.columns
            where table_schema = 'recovery' and table_name = 'deletion_tombstones') as fields
        from recovery.deletion_tombstones where deletion_id = ${deletionId}::uuid`;
      assertEquals(stored, { count: 1, fields: 3 });

      await assertRejects(async () => {
        await sql.begin(async (transaction) => {
          await transaction.unsafe("set local role anon");
          await transaction`select public.record_deletion_tombstone_v1(
            ${playerId}::uuid, ${deletionId}::uuid, ${recordedAt}::timestamptz
          )`;
        });
      });
    } finally {
      await sql`delete from recovery.deletion_tombstones
        where surrogate_player_id in (${playerId}::uuid, ${otherPlayerId}::uuid)
          or deletion_id = ${deletionId}::uuid`;
    }
  });
});

Deno.test("recovery migrations contain no Telegram identity or message fields", async () => {
  const migration001 = await Deno.readTextFile(
    "recovery-control/migrations/202607130001_deletion_tombstones.sql",
  );
  const migration002 = await Deno.readTextFile(
    "recovery-control/migrations/202607150002_record_deletion_tombstone.sql",
  );
  for (const forbidden of ["telegram", "username", "display_name", "message", "external_id"]) {
    assertEquals((migration001 + migration002).toLowerCase().includes(forbidden), false);
  }
});

Deno.test("concurrent conflicting recovery writes retain exactly one tombstone", async () => {
  await ensureRecoveryDatabase();
  const concurrentPlayerA = "60000000-0000-4000-8000-000000000085";
  const concurrentPlayerB = "60000000-0000-4000-8000-000000000086";
  const concurrentDeletion = "61000000-0000-5000-8000-000000000085";
  await withRecoveryDatabase(async (sql) => {
    await sql`delete from recovery.deletion_tombstones
      where surrogate_player_id in (${concurrentPlayerA}::uuid, ${concurrentPlayerB}::uuid)
        or deletion_id = ${concurrentDeletion}::uuid`;
    try {
      const write = (player: string) =>
        sql.begin(async (transaction) => {
          const [row] = await transaction<{ result: { status: string } }[]>`
            select public.record_deletion_tombstone_v1(
              ${player}::uuid,
              ${concurrentDeletion}::uuid,
              '2026-07-16T12:15:00.000Z'::timestamptz
            ) as result`;
          return row.result.status;
        });
      const statuses = await Promise.all([
        write(concurrentPlayerA),
        write(concurrentPlayerB),
      ]);
      assertEquals(statuses.toSorted(), ["applied", "rejected"]);
      const [stored] = await sql<{ count: number }[]>`
        select count(*)::integer as count from recovery.deletion_tombstones
        where deletion_id = ${concurrentDeletion}::uuid`;
      assertEquals(stored.count, 1);
    } finally {
      await sql`delete from recovery.deletion_tombstones
        where surrogate_player_id in (${concurrentPlayerA}::uuid, ${concurrentPlayerB}::uuid)
          or deletion_id = ${concurrentDeletion}::uuid`;
    }
  });
});
