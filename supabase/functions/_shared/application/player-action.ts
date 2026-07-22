import type { CommandResult, DatabasePort } from "./database-port.ts";

export type PurchasableStat = "physical" | "magical" | "agility" | "vitality";
export type StarterRingKind = "weapon" | "fire" | "defense" | "healing";

export type ProfileAction =
  | { readonly kind: "buy_stat"; readonly stat: PurchasableStat }
  | { readonly kind: "defer_stat" }
  | { readonly kind: "accept_item"; readonly offerId: string }
  | { readonly kind: "discard_item"; readonly offerId: string }
  | {
    readonly kind: "choose_ring";
    readonly offerId: string;
    readonly ringKind: StarterRingKind;
  }
  | { readonly kind: "train_ring_mastery" };

export interface PreparePlayerActionInput {
  readonly playerId: string;
  readonly tokenSha256: string;
  readonly profileVersion: number;
  readonly messageId: bigint;
  readonly action: ProfileAction;
  readonly contextSha256: string;
  readonly expiresAt: string;
}

export interface ResolvePlayerActionInput {
  readonly tokenSha256: string;
  readonly telegramUpdateId: bigint;
  readonly actorPlayerId: string;
  readonly callbackMessageId: bigint;
  readonly contextSha256: string;
}

export function preparePlayerAction(
  database: DatabasePort,
  input: PreparePlayerActionInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("prepare_player_action_v1", {
    p_player_id: input.playerId,
    p_token_sha256: input.tokenSha256,
    p_expected_profile_version: input.profileVersion,
    p_expected_message_id: input.messageId.toString(),
    p_action: input.action,
    p_context_sha256: input.contextSha256,
    p_expires_at: input.expiresAt,
  });
}

export function resolvePlayerAction(
  database: DatabasePort,
  input: ResolvePlayerActionInput,
): Promise<CommandResult> {
  return database.call<CommandResult>("resolve_player_action_v2", {
    p_token_sha256: input.tokenSha256,
    p_telegram_update_id: input.telegramUpdateId.toString(),
    p_actor_player_id: input.actorPlayerId,
    p_callback_message_id: input.callbackMessageId.toString(),
    p_context_sha256: input.contextSha256,
  });
}
