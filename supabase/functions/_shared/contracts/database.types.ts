// Generated locally from the public RPC contract in migration 202607120008.
// The private `game` schema is intentionally absent from the Data API surface.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      begin_identity_deletion_v1: {
        Args: { p_deletion_id: string; p_player_id: string };
        Returns: Json;
      };
      finalize_identity_deletion_v1: {
        Args: { p_deletion_id: string; p_player_id: string };
        Returns: Json;
      };
      prepare_action_v1: {
        Args: {
          p_choice_id: string;
          p_context_sha256: string;
          p_exchange: number;
          p_expected_state_version: number;
          p_expires_at: string;
          p_player_id: string;
          p_prepared_resolution: Json;
          p_resolution_sha256: string;
          p_run_id: string;
          p_stage: number;
          p_token_sha256: string;
        };
        Returns: Json;
      };
      resolve_choice_v1: {
        Args: {
          p_actor_player_id: string;
          p_context_sha256: string;
          p_telegram_update_id: number;
          p_token_sha256: string;
        };
        Returns: Json;
      };
      resume_v1: {
        Args: { p_player_id: string };
        Returns: Json;
      };
      start_run_v1: {
        Args: {
          p_cycle_id: string;
          p_loadout_snapshot: Json;
          p_loadout_snapshot_sha256: string;
          p_player_id: string;
          p_self_snapshot: Json;
          p_self_snapshot_sha256: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
