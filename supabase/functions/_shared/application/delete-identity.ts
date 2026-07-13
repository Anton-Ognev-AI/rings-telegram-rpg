import type { CommandResult, DatabasePort } from "./database-port.ts";

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
