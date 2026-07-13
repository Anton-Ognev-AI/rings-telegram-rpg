import type { CommandResult, DatabasePort } from "./database-port.ts";

export interface LeaseOutboxInput {
  readonly workerId: string;
  readonly limit: number;
  readonly leaseSeconds: number;
  readonly at: string;
}

export interface CompleteOutboxInput {
  readonly outboxId: string;
  readonly leaseId: string;
  readonly result: "sent" | "retry" | "delivery_unknown" | "dead" | "superseded";
  readonly telegramMessageId: bigint | null;
  readonly retryAt: string | null;
  readonly at: string;
}

export interface AuthorizeOutboxDeliveryInput {
  readonly outboxId: string;
  readonly leaseId: string;
  readonly at: string;
}

export function leaseOutbox(
  database: DatabasePort,
  input: LeaseOutboxInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("lease_outbox_v2", {
    p_worker_id: input.workerId,
    p_limit: input.limit,
    p_lease_seconds: input.leaseSeconds,
    p_at: input.at,
  });
}

export function authorizeOutboxDelivery(
  database: DatabasePort,
  input: AuthorizeOutboxDeliveryInput,
): Promise<unknown> {
  return database.call<unknown>("authorize_outbox_delivery_v1", {
    p_outbox_id: input.outboxId,
    p_lease_id: input.leaseId,
    p_at: input.at,
  });
}

export function completeOutbox(
  database: DatabasePort,
  input: CompleteOutboxInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("complete_outbox_v1", {
    p_outbox_id: input.outboxId,
    p_lease_id: input.leaseId,
    p_result: input.result,
    p_telegram_message_id: input.telegramMessageId?.toString() ?? null,
    p_retry_at: input.retryAt,
    p_at: input.at,
  });
}
