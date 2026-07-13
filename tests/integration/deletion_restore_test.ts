import { assertEquals } from "jsr:@std/assert@1.0.19";
import postgres, { type Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  ensureRecoveryDatabase,
  LocalRecoveryDeletionSink,
  withRecoveryDatabase,
} from "../../scripts/recovery/local-recovery-database.ts";
import { replayTombstones } from "../../scripts/recovery/replay-tombstones.ts";
import type {
  CommandResult,
  DatabasePort,
} from "../../supabase/functions/_shared/application/database-port.ts";
import { deleteIdentity } from "../../supabase/functions/_shared/application/delete-identity.ts";

const ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RESTORED_URL = "postgresql://postgres:postgres@127.0.0.1:54322/restored_primary_test";

class SqlDeletionPort implements DatabasePort {
  constructor(private readonly sql: Sql) {}
  async call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    if (rpc !== "begin_identity_deletion_v1" && rpc !== "finalize_identity_deletion_v1") {
      throw new Error(`unsupported RPC: ${rpc}`);
    }
    const rows = rpc === "begin_identity_deletion_v1"
      ? await this.sql<{ response: CommandResult }[]>`select public.begin_identity_deletion_v1(
          ${String(args.p_player_id)}::uuid, ${String(args.p_deletion_id)}::uuid
        ) as response`
      : await this.sql<{ response: CommandResult }[]>`select public.finalize_identity_deletion_v1(
          ${String(args.p_player_id)}::uuid, ${String(args.p_deletion_id)}::uuid
        ) as response`;
    const [row] = rows;
    return row.response as T;
  }
}

async function recreateRestoredDatabase(): Promise<Sql> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  const [existing] = await admin<{ exists: boolean }[]>`
    select exists(select 1 from pg_catalog.pg_database
      where datname = 'restored_primary_test') as exists
  `;
  if (existing.exists) await admin.unsafe("drop database restored_primary_test with (force)");
  await admin.unsafe("create database restored_primary_test");
  await admin.end();
  const restored = postgres(RESTORED_URL, { max: 2 });
  await restored.unsafe(`
    create schema game;
    create type game.identity_deletion_state as enum ('active', 'deletion_pending');
    create table game.players(
      id uuid primary key,
      deletion_state game.identity_deletion_state not null default 'active',
      deletion_id uuid,
      deletion_requested_at timestamptz,
      personal_label text
    );
    create table game.identity_links(
      id uuid primary key,
      player_id uuid not null references game.players(id) on delete cascade,
      platform text not null,
      external_id bigint not null
    );
  `);
  return restored;
}

Deno.test("deletion tombstone removes identity after isolated primary restore", async () => {
  const migration = await Deno.readTextFile(
    "recovery-control/migrations/202607130001_deletion_tombstones.sql",
  );
  for (const forbidden of ["telegram", "username", "display_name", "message", "external_id"]) {
    assertEquals(migration.toLowerCase().includes(forbidden), false);
  }

  await ensureRecoveryDatabase();
  const playerId = "60000000-0000-4000-8000-000000000001";
  const deletionId = "61000000-0000-4000-8000-000000000001";
  const identityId = "62000000-0000-4000-8000-000000000001";
  const replacementPlayerId = "60000000-0000-4000-8000-000000000002";
  const replacementIdentityId = "62000000-0000-4000-8000-000000000002";
  const externalId = 900000000000000601n;

  await withDatabase(async (primary) => {
    await primary`insert into game.players(id, personal_label)
      values (${playerId}::uuid, 'Restored Synthetic Student')`;
    await primary`insert into game.identity_links(id, player_id, platform, external_id)
      values (${identityId}::uuid, ${playerId}::uuid, 'telegram', ${externalId.toString()}::bigint)`;
    await primary`insert into game.player_stats(
      player_id, physical, magical, agility, vitality, defense, max_hp
    ) values (${playerId}::uuid, 1, 1, 1, 1, 1, 10)`;
    await primary`insert into game.xp_accounts(player_id) values (${playerId}::uuid)`;

    await deleteIdentity(new SqlDeletionPort(primary), new LocalRecoveryDeletionSink(), {
      surrogatePlayerId: playerId,
      deletionId,
      recordedAt: "2026-07-13T12:00:00.000Z",
    });
    const [primaryIdentity] = await primary<{ count: number }[]>`
      select count(*)::integer as count from game.identity_links where player_id = ${playerId}::uuid
    `;
    assertEquals(primaryIdentity.count, 0);
  });

  const restored = await recreateRestoredDatabase();
  try {
    await restored`insert into game.players(id, personal_label)
      values (${playerId}::uuid, 'Restored Synthetic Student')`;
    await restored`insert into game.identity_links(id, player_id, platform, external_id)
      values (${identityId}::uuid, ${playerId}::uuid, 'telegram', ${externalId.toString()}::bigint)`;

    await withRecoveryDatabase(async (recovery) => {
      assertEquals(await replayTombstones(restored, recovery) >= 1, true);
      assertEquals(await replayTombstones(restored, recovery) >= 1, true);
    });
    const [identity] = await restored<{ count: number }[]>`
      select count(*)::integer as count from game.identity_links where player_id = ${playerId}::uuid
    `;
    const [player] = await restored<{ deletion_state: string; personal_label: string | null }[]>`
      select deletion_state, personal_label from game.players where id = ${playerId}::uuid
    `;
    assertEquals(identity.count, 0);
    assertEquals(player, { deletion_state: "deletion_pending", personal_label: null });

    await restored`insert into game.players(id, personal_label)
      values (${replacementPlayerId}::uuid, 'Replacement Synthetic Student')`;
    await restored`insert into game.identity_links(id, player_id, platform, external_id)
      values (
        ${replacementIdentityId}::uuid,
        ${replacementPlayerId}::uuid,
        'telegram',
        ${externalId.toString()}::bigint
      )`;
    await withRecoveryDatabase(async (recovery) => {
      assertEquals(await replayTombstones(restored, recovery) >= 1, true);
    });
    const [replacement] = await restored<{
      links: number;
      deletion_state: string;
      personal_label: string | null;
    }[]>`select
      (select count(*)::integer from game.identity_links
        where player_id = p.id) as links,
      p.deletion_state,
      p.personal_label
      from game.players p where p.id = ${replacementPlayerId}::uuid`;
    assertEquals(replacement, {
      links: 1,
      deletion_state: "active",
      personal_label: "Replacement Synthetic Student",
    });
  } finally {
    await restored.end();
    const admin = postgres(ADMIN_URL, { max: 1 });
    await admin.unsafe("drop database restored_primary_test with (force)");
    await admin.end();
  }
});
