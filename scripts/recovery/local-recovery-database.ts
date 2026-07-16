import postgres, { type Sql } from "npm:postgres@3.4.7";
import type { IdentityDeletionSink } from "../../supabase/functions/_shared/application/delete-identity.ts";
import { assertLocalDatabaseUrl, redactDatabaseError } from "../db/local-database.ts";

export const RECOVERY_DATABASE_NAME = "recovery_control";
export const RECOVERY_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/recovery_control";
const ADMIN_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function ensureRecoveryDatabase(): Promise<void> {
  assertLocalDatabaseUrl(ADMIN_DATABASE_URL);
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  try {
    const [existing] = await admin<{ exists: boolean }[]>`
      select exists(select 1 from pg_catalog.pg_database
        where datname = ${RECOVERY_DATABASE_NAME}) as exists
    `;
    if (!existing.exists) await admin.unsafe(`create database ${RECOVERY_DATABASE_NAME}`);
  } catch (error) {
    throw redactDatabaseError(error, ADMIN_DATABASE_URL);
  } finally {
    await admin.end({ timeout: 5 });
  }

  for (
    const migrationPath of [
      "recovery-control/migrations/202607130001_deletion_tombstones.sql",
      "recovery-control/migrations/202607150002_record_deletion_tombstone.sql",
    ]
  ) {
    const migration = await Deno.readTextFile(migrationPath);
    await withRecoveryDatabase((sql) => sql.unsafe(migration));
  }
}

export async function withRecoveryDatabase<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
  assertLocalDatabaseUrl(RECOVERY_DATABASE_URL);
  const sql = postgres(RECOVERY_DATABASE_URL, { max: 5 });
  try {
    return await work(sql);
  } catch (error) {
    throw redactDatabaseError(error, RECOVERY_DATABASE_URL);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export class LocalRecoveryDeletionSink implements IdentityDeletionSink {
  async recordTombstone(input: {
    surrogatePlayerId: string;
    deletionId: string;
    recordedAt: string;
  }): Promise<void> {
    await withRecoveryDatabase(async (sql) => {
      await sql`insert into recovery.deletion_tombstones(
        surrogate_player_id, deletion_id, recorded_at
      ) values (
        ${input.surrogatePlayerId}::uuid, ${input.deletionId}::uuid, ${input.recordedAt}::timestamptz
      ) on conflict (deletion_id) do nothing`;
      const [stored] = await sql<{ surrogate_player_id: string }[]>`
        select surrogate_player_id from recovery.deletion_tombstones
        where deletion_id = ${input.deletionId}::uuid
      `;
      if (!stored || stored.surrogate_player_id !== input.surrogatePlayerId) {
        throw new Error("deletion tombstone conflict");
      }
    });
  }
}

if (import.meta.main) await ensureRecoveryDatabase();
