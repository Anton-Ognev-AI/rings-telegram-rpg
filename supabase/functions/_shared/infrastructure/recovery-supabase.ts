import type { IdentityDeletionSink } from "../application/delete-identity.ts";
import { type FetchPort, SupabaseRpcDatabase } from "./supabase-rpc.ts";

interface TombstoneResult {
  readonly status?: string;
}

function canonicalRecoveryUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_recovery_configuration");
  }
  if (
    parsed.protocol !== "https:" ||
    !/^[a-z0-9]{20}\.supabase\.co$/u.test(parsed.hostname) ||
    parsed.port !== "" || parsed.username !== "" || parsed.password !== "" ||
    parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== ""
  ) {
    throw new Error("invalid_recovery_configuration");
  }
  return parsed.origin;
}

export class SupabaseRecoveryDeletionSink implements IdentityDeletionSink {
  readonly #database: SupabaseRpcDatabase;

  constructor(
    recoveryUrl: string,
    serviceRoleKey: string,
    fetcher: FetchPort = fetch,
  ) {
    try {
      this.#database = new SupabaseRpcDatabase(
        canonicalRecoveryUrl(recoveryUrl),
        serviceRoleKey,
        fetcher,
      );
    } catch {
      throw new Error("invalid_recovery_configuration");
    }
  }

  async recordTombstone(input: {
    readonly surrogatePlayerId: string;
    readonly deletionId: string;
    readonly recordedAt: string;
  }): Promise<void> {
    let result: TombstoneResult;
    try {
      result = await this.#database.call<TombstoneResult>("record_deletion_tombstone_v1", {
        p_surrogate_player_id: input.surrogatePlayerId,
        p_deletion_id: input.deletionId,
        p_recorded_at: input.recordedAt,
      });
    } catch {
      throw new Error("recovery_tombstone_unavailable");
    }
    if (result.status !== "applied" && result.status !== "cached") {
      throw new Error("recovery_tombstone_rejected");
    }
  }
}
