import type { Sql } from "npm:postgres@3.4.7";
import type { DatabasePort } from "../../../supabase/functions/_shared/application/database-port.ts";

function stringArgument(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new Error(`invalid_rpc_argument:${name}`);
  return value;
}

function numberArgument(args: Readonly<Record<string, unknown>>, name: string): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid_rpc_argument:${name}`);
  }
  return value;
}

function integerStringArgument(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^[0-9]+$/u.test(String(value))
  ) throw new Error(`invalid_rpc_argument:${name}`);
  return String(value);
}

function recordArgument(
  args: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> {
  const value = args[name];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid_rpc_argument:${name}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function jsonArgument(args: Readonly<Record<string, unknown>>, name: string) {
  return JSON.parse(JSON.stringify(recordArgument(args, name)));
}

export class PostgresRpcDatabase implements DatabasePort {
  constructor(private readonly sql: Sql) {}

  async call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    let rows: Array<{ response: unknown }>;
    switch (rpc) {
      case "telegram_identity_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.telegram_identity_v1(
          ${stringArgument(args, "p_external_id")}::bigint,
          ${Boolean(args.p_create_if_missing)}::boolean
        ) as response`;
        break;
      case "telegram_deletion_identity_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.telegram_deletion_identity_v1(
          ${stringArgument(args, "p_external_id")}::bigint
        ) as response`;
        break;
      case "publish_fallback_day_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.publish_fallback_day_v1(
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "advance_day_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.advance_day_v1(
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "start_run_v2":
        rows = await this.sql<{ response: unknown }[]>`select public.start_run_v2(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_at")}::timestamptz,
          ${this.sql.json(jsonArgument(args, "p_self_snapshot"))}::jsonb,
          ${stringArgument(args, "p_self_snapshot_sha256")},
          ${this.sql.json(jsonArgument(args, "p_loadout_snapshot"))}::jsonb,
          ${stringArgument(args, "p_loadout_snapshot_sha256")}
        ) as response`;
        break;
      case "resume_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.resume_v1(
          ${stringArgument(args, "p_player_id")}::uuid
        ) as response`;
        break;
      case "run_view_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.run_view_v1(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${args.p_run_id === null ? null : stringArgument(args, "p_run_id")}::uuid
        ) as response`;
        break;
      case "request_run_render_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.request_run_render_v1(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_run_id")}::uuid,
          ${stringArgument(args, "p_request_key")}
        ) as response`;
        break;
      case "prepare_action_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.prepare_action_v1(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_run_id")}::uuid,
          ${stringArgument(args, "p_token_sha256")},
          ${integerStringArgument(args, "p_expected_state_version")}::bigint,
          ${numberArgument(args, "p_stage")}::smallint,
          ${numberArgument(args, "p_exchange")}::smallint,
          ${stringArgument(args, "p_choice_id")},
          ${stringArgument(args, "p_context_sha256")},
          ${this.sql.json(jsonArgument(args, "p_prepared_resolution"))}::jsonb,
          ${stringArgument(args, "p_resolution_sha256")},
          ${stringArgument(args, "p_expires_at")}::timestamptz
        ) as response`;
        break;
      case "resolve_choice_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.resolve_choice_v1(
          ${stringArgument(args, "p_token_sha256")},
          ${stringArgument(args, "p_telegram_update_id")}::bigint,
          ${stringArgument(args, "p_actor_player_id")}::uuid,
          ${stringArgument(args, "p_context_sha256")}
        ) as response`;
        break;
      case "lease_outbox_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.lease_outbox_v1(
          ${stringArgument(args, "p_worker_id")}::uuid,
          ${numberArgument(args, "p_limit")}::integer,
          ${numberArgument(args, "p_lease_seconds")}::integer,
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "lease_outbox_v2":
        rows = await this.sql<{ response: unknown }[]>`select public.lease_outbox_v2(
          ${stringArgument(args, "p_worker_id")}::uuid,
          ${numberArgument(args, "p_limit")}::integer,
          ${numberArgument(args, "p_lease_seconds")}::integer,
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "authorize_outbox_delivery_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.authorize_outbox_delivery_v1(
          ${stringArgument(args, "p_outbox_id")}::uuid,
          ${stringArgument(args, "p_lease_id")}::uuid,
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "complete_outbox_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.complete_outbox_v1(
          ${stringArgument(args, "p_outbox_id")}::uuid,
          ${stringArgument(args, "p_lease_id")}::uuid,
          ${stringArgument(args, "p_result")},
          ${
          args.p_telegram_message_id === null ? null : stringArgument(args, "p_telegram_message_id")
        }::bigint,
          ${args.p_retry_at === null ? null : stringArgument(args, "p_retry_at")}::timestamptz,
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "begin_identity_deletion_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.begin_identity_deletion_v1(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_deletion_id")}::uuid
        ) as response`;
        break;
      case "begin_identity_deletion_v2":
        rows = await this.sql<{ response: unknown }[]>`select public.begin_identity_deletion_v2(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_deletion_id")}::uuid,
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      case "finalize_identity_deletion_v1":
        rows = await this.sql<{ response: unknown }[]>`select public.finalize_identity_deletion_v1(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_deletion_id")}::uuid
        ) as response`;
        break;
      case "finalize_identity_deletion_v2":
        rows = await this.sql<{ response: unknown }[]>`select public.finalize_identity_deletion_v2(
          ${stringArgument(args, "p_player_id")}::uuid,
          ${stringArgument(args, "p_deletion_id")}::uuid,
          ${stringArgument(args, "p_at")}::timestamptz
        ) as response`;
        break;
      default:
        throw new Error(`unsupported_test_rpc:${rpc}`);
    }
    const row = rows[0];
    if (!row) throw new Error(`empty_test_rpc:${rpc}`);
    return row.response as T;
  }
}
