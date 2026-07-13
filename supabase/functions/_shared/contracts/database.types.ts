// Generated locally from the public RPC contract through migration 202607130010.
// The private `game` schema is intentionally absent from the Data API surface.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      abandon_run_v1: {
        Args: { p_player_id: string; p_run_id: string };
        Returns: Json;
      };
      advance_day_v1: {
        Args: { p_at: string };
        Returns: Json;
      };
      begin_identity_deletion_v1: {
        Args: { p_deletion_id: string; p_player_id: string };
        Returns: Json;
      };
      complete_outbox_v1: {
        Args: {
          p_at: string;
          p_lease_id: string;
          p_outbox_id: string;
          p_result: string;
          p_retry_at: string | null;
          p_telegram_message_id: number | null;
        };
        Returns: Json;
      };
      finalize_identity_deletion_v1: {
        Args: { p_deletion_id: string; p_player_id: string };
        Returns: Json;
      };
      lease_outbox_v1: {
        Args: {
          p_at: string;
          p_lease_seconds: number;
          p_limit: number;
          p_worker_id: string;
        };
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
      publish_fallback_day_v1: {
        Args: { p_at: string };
        Returns: Json;
      };
      request_run_render_v1: {
        Args: { p_player_id: string; p_request_key: string; p_run_id: string };
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
      run_view_v1: {
        Args: { p_player_id: string; p_run_id?: string | null };
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
      start_run_v2: {
        Args: {
          p_at: string;
          p_loadout_snapshot: Json;
          p_loadout_snapshot_sha256: string;
          p_player_id: string;
          p_self_snapshot: Json;
          p_self_snapshot_sha256: string;
        };
        Returns: Json;
      };
      telegram_identity_v1: {
        Args: { p_create_if_missing: boolean; p_external_id: number };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
