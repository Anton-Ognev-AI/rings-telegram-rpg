import fallback from "../../content/fallback/case-001/day-01.json" with { type: "json" };
import type { DungeonContentV1 } from "../../supabase/functions/_shared/contracts/content.ts";
import {
  canonicalJson,
  sha256Hex,
} from "../../supabase/functions/_shared/domain/canonical-json.ts";
import { validateDungeonContentV1 } from "../../supabase/functions/_shared/domain/content-validator.ts";
import { withDatabase } from "./local-database.ts";

const SUSPICIOUS_CYRILLIC_MOJIBAKE =
  /[\u0402\u0403\u0405\u0408-\u040f\u0451-\u0453\u0455\u0458-\u045f]/u;

export interface ContentSeedRecord {
  readonly externalId: string;
  readonly schemaVersion: string;
  readonly resolverVersion: string;
  readonly payload: DungeonContentV1;
  readonly payloadSha256: string;
  readonly validationStatus: "fallback_validated";
  readonly cycleId: string;
}

export async function buildContentSeedRecord(
  content: unknown,
  cycleId: string,
): Promise<ContentSeedRecord> {
  if (SUSPICIOUS_CYRILLIC_MOJIBAKE.test(canonicalJson(content))) {
    throw new Error("invalid fallback content: suspicious_mojibake");
  }
  const validation = validateDungeonContentV1(content);
  if (!validation.ok) {
    throw new Error(`invalid fallback content: ${validation.errors.join(" | ")}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleId)) throw new Error("invalid cycle ID");
  const payload = content as DungeonContentV1;
  return {
    externalId: payload.id,
    schemaVersion: payload.schemaVersion,
    resolverVersion: payload.resolverVersion,
    payload,
    payloadSha256: await sha256Hex(canonicalJson(payload)),
    validationStatus: "fallback_validated",
    cycleId,
  };
}

async function main(): Promise<void> {
  const record = await buildContentSeedRecord(fallback, "2026-07-13");
  await withDatabase(async (sql) => {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into game.content_versions (
          id, external_id, schema_version, resolver_version, payload, payload_sha256,
          validation_status, validation_report
        ) values (
          '20000000-0000-4000-8000-000000000001', ${record.externalId},
          ${record.schemaVersion}, ${record.resolverVersion},
          ${transaction.json(JSON.parse(canonicalJson(record.payload)))},
          ${record.payloadSha256}, ${record.validationStatus}, ${transaction.json({ errors: [] })}
        ) on conflict (external_id, payload_sha256) do nothing
      `;
      const [content] = await transaction<{ id: string }[]>`
        select id from game.content_versions
        where external_id = ${record.externalId} and payload_sha256 = ${record.payloadSha256}
      `;
      if (!content) throw new Error("seeded content row not found");
      await transaction`
        insert into game.fallback_content (slot, content_version_id)
        values ('daily-v1', ${content.id})
        on conflict (slot) do update set content_version_id = excluded.content_version_id
      `;
      await transaction`
        insert into game.dungeon_days (
          cycle_id, content_version_id, opens_at, closes_at, grace_ends_at, status
        ) values (
          ${record.cycleId}::date,
          ${content.id},
          ((${record.cycleId}::date + time '09:00') at time zone 'Europe/Kyiv'),
          ((((${record.cycleId}::date + 1) + time '09:00')) at time zone 'Europe/Kyiv'),
          ((((${record.cycleId}::date + 1) + time '09:00')) at time zone 'Europe/Kyiv')
            + interval '2 hours',
          'fallback_ready'
        ) on conflict (cycle_id) do update set
          content_version_id = excluded.content_version_id,
          opens_at = excluded.opens_at,
          closes_at = excluded.closes_at,
          grace_ends_at = excluded.grace_ends_at,
          status = excluded.status
      `;
    });
  });
}

if (import.meta.main) await main();
