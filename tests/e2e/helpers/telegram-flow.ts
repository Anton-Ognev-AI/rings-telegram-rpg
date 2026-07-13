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

const DEVELOPED_E2E_BUILD: NonNullable<TelegramHandlerDependencies["startBuild"]> = {
  selfSnapshot: {
    maxHp: 100,
    physical: 70,
    magical: 70,
    agility: 70,
    vitality: 70,
    defense: 0,
    vampRateBps: 0,
    postHeal: 0,
  },
  loadoutSnapshot: {
    partyMode: "solo",
    companion: null,
    items: [],
    rings: [],
  },
};

const noDeletion: IdentityDeletionSink = {
  recordTombstone: () => Promise.reject(new Error("deletion_not_used_in_gate_3b")),
};

export function fixedClock(at: string): Clock {
  return new FixedClock(at);
}

export async function handleWithRestart(
  sql: Sql,
  at: string,
  update: NormalizedTelegramUpdate,
  telegram = new RecordingTelegramPort(),
): Promise<{ result: TelegramHandlerResult; telegram: RecordingTelegramPort }> {
  const dependencies: TelegramHandlerDependencies = {
    database: new PostgresRpcDatabase(sql),
    telegram,
    clock: fixedClock(at),
    deletionSink: noDeletion,
    callbackKey: CALLBACK_KEY,
    startBuild: DEVELOPED_E2E_BUILD,
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
