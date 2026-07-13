import type { CommandResult, DatabasePort } from "./database-port.ts";
import { sha256Hex } from "../domain/canonical-json.ts";

export interface IdentityDeletionSink {
  recordTombstone(input: {
    readonly surrogatePlayerId: string;
    readonly deletionId: string;
    readonly recordedAt: string;
  }): Promise<void>;
}

export interface DeleteIdentityInput {
  readonly surrogatePlayerId: string;
  readonly deletionId: string;
  readonly recordedAt: string;
}

export async function deriveDeletionId(surrogatePlayerId: string): Promise<string> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      surrogatePlayerId,
    )
  ) throw new Error("invalid_surrogate_player_id");
  const hex = (await sha256Hex(`deletion-context-v1:${surrogatePlayerId}`)).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join("");
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20, 32),
  ].join("-");
}

export async function deleteIdentity(
  database: DatabasePort,
  sink: IdentityDeletionSink,
  input: DeleteIdentityInput,
): Promise<CommandResult> {
  const args = {
    p_player_id: input.surrogatePlayerId,
    p_deletion_id: input.deletionId,
  };
  const begun = await database.call<CommandResult>("begin_identity_deletion_v1", args);
  if (begun.status !== "applied" && begun.status !== "cached") {
    throw new Error(`identity deletion begin rejected: ${String(begun.reason ?? "unknown")}`);
  }

  await sink.recordTombstone(input);

  const finalized = await database.call<CommandResult>("finalize_identity_deletion_v1", args);
  if (finalized.status !== "applied" && finalized.status !== "cached") {
    throw new Error(
      `identity deletion finalize rejected: ${String(finalized.reason ?? "unknown")}`,
    );
  }
  return { ...finalized, status: "applied" };
}

export async function deleteTelegramIdentity(
  database: DatabasePort,
  sink: IdentityDeletionSink,
  input: DeleteIdentityInput,
): Promise<CommandResult> {
  const args = {
    p_player_id: input.surrogatePlayerId,
    p_deletion_id: input.deletionId,
    p_at: input.recordedAt,
  };
  const begun = await database.call<CommandResult>("begin_identity_deletion_v2", args);
  if (begun.status !== "applied" && begun.status !== "cached") {
    throw new Error(`identity deletion begin rejected: ${String(begun.reason ?? "unknown")}`);
  }

  await sink.recordTombstone(input);

  const finalized = await database.call<CommandResult>("finalize_identity_deletion_v2", args);
  if (finalized.status !== "applied" && finalized.status !== "cached") {
    throw new Error(
      `identity deletion finalize rejected: ${String(finalized.reason ?? "unknown")}`,
    );
  }
  return { ...finalized, status: "applied" };
}
