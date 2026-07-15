import type { Sql } from "npm:postgres@3.4.7";
import type { IdentityDeletionSink } from "../../../supabase/functions/_shared/application/delete-identity.ts";
import { processOutboxBatch } from "../../../supabase/functions/_shared/application/process-outbox.ts";
import type { Clock } from "../../../supabase/functions/_shared/infrastructure/clock.ts";
import { FixedClock } from "../../../supabase/functions/_shared/infrastructure/clock.ts";
import { RecordingTelegramPort } from "../../../supabase/functions/_shared/telegram/fake.ts";
import {
  handleTelegramUpdate,
  type TelegramHandlerDependencies,
  type TelegramHandlerResult,
} from "../../../supabase/functions/_shared/telegram/handler.ts";
import type { NormalizedTelegramUpdate } from "../../../supabase/functions/_shared/telegram/update.ts";
import { PostgresRpcDatabase } from "./postgres-rpc.ts";

export const CALLBACK_KEY = new TextEncoder().encode("local-e2e-callback-key-32-bytes!!");

const noDeletion: IdentityDeletionSink = {
  recordTombstone: () => Promise.reject(new Error("deletion_not_used_in_gate_3b")),
};

export function fixedClock(at: string): Clock {
  return new FixedClock(at);
}

async function prepareDevelopedE2eProfile(sql: Sql, externalId: bigint): Promise<void> {
  const [identity] = await sql<{ player_id: string }[]>`
    select (public.telegram_identity_v2(
      ${externalId.toString()}::bigint, true
    )->>'playerId')::uuid as player_id
  `;
  if (!identity) throw new Error("missing_e2e_identity");
  await sql`update game.player_stats set
      physical = 70, magical = 70, agility = 70, vitality = 70,
      defense = 0, max_hp = 100
    where player_id = ${identity.player_id}::uuid`;
  await sql`update game.player_onboarding set
      tutorial_completed = 2,
      academy_rank = 'novice',
      initial_training_resolved_at = coalesce(initial_training_resolved_at, clock_timestamp()),
      profile_version = profile_version + 1
    where player_id = ${identity.player_id}::uuid
      and tutorial_completed < 2`;
}

export async function handleWithRestart(
  sql: Sql,
  at: string,
  update: NormalizedTelegramUpdate,
  telegram = new RecordingTelegramPort(),
): Promise<{ result: TelegramHandlerResult; telegram: RecordingTelegramPort }> {
  if (
    update.kind === "callback" && update.data === "nav:expedition" ||
    update.kind === "command" && update.command === "expedition"
  ) {
    await prepareDevelopedE2eProfile(sql, update.telegramExternalId);
  }
  const dependencies: TelegramHandlerDependencies = {
    database: new PostgresRpcDatabase(sql),
    telegram,
    clock: fixedClock(at),
    deletionSink: noDeletion,
    callbackKey: CALLBACK_KEY,
  };
  return { result: await handleTelegramUpdate(dependencies, update), telegram };
}

export async function workWithRestart(
  sql: Sql,
  at: string,
  workerId: string,
): Promise<
  { result: Awaited<ReturnType<typeof processOutboxBatch>>; telegram: RecordingTelegramPort }
> {
  const telegram = new RecordingTelegramPort();
  const result = await processOutboxBatch({
    database: new PostgresRpcDatabase(sql),
    telegram,
    clock: fixedClock(at),
    callbackKey: CALLBACK_KEY,
  }, { workerId, limit: 10, leaseSeconds: 30 });
  return { result, telegram };
}
