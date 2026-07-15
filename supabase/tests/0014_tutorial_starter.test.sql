begin;
select plan(42);

select has_table('game', 'progression_config_versions', 'progression config table exists');
select has_table('game', 'player_onboarding', 'player onboarding table exists');
select has_table('game', 'player_stat_progression', 'stat progression table exists');
select has_table('game', 'tutorial_run_assignments', 'tutorial assignment table exists');
select has_table('game', 'player_equipment', 'current equipment table exists');
select has_table('game', 'player_rings', 'current ring table exists');
select has_table('game', 'player_offers', 'ordered offer table exists');
select has_table('game', 'player_action_tokens', 'profile action token table exists');
select has_table('game', 'processed_player_actions', 'processed profile action table exists');

select is((select count(*)::integer
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'game'
    and c.relname in (
      'progression_config_versions', 'player_onboarding', 'player_stat_progression',
      'tutorial_run_assignments', 'player_equipment', 'player_rings', 'player_offers',
      'player_action_tokens', 'processed_player_actions'
    ) and c.relrowsecurity), 9, 'all Phase 4A tables enable RLS');

select is((select count(*)::integer
  from information_schema.table_privileges
  where table_schema = 'game'
    and table_name in (
      'progression_config_versions', 'player_onboarding', 'player_stat_progression',
      'tutorial_run_assignments', 'player_equipment', 'player_rings', 'player_offers',
      'player_action_tokens', 'processed_player_actions'
    ) and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  0, 'API roles have no direct Phase 4A table access');

select has_function('public', 'telegram_identity_v2', 'identity v2 exists');
select has_function('public', 'player_home_v1', 'canonical home query exists');
select has_function('public', 'start_run_v3', 'server-derived start exists');
select has_function('public', 'run_view_v2', 'tutorial run view exists');
select has_function('public', 'prepare_action_v2', 'tutorial-aware run preparation exists');
select has_function('public', 'resolve_choice_v2', 'tutorial-aware run resolution exists');
select has_function('public', 'advance_day_v2', 'tutorial-aware lifecycle exists');
select has_function('public', 'prepare_player_action_v1', 'profile action preparation exists');
select has_function('public', 'resolve_player_action_v1', 'profile action resolution exists');
select has_function('public', 'request_run_render_v2', 'coalesced render repair exists');
select has_function('game', 'credit_tutorial_run_v1', 'private tutorial credit helper exists');
select ok(not has_function_privilege(
  'service_role', 'game.credit_tutorial_run_v1(uuid,timestamp with time zone)', 'execute'
), 'service role cannot execute the private tutorial credit helper');
select has_function('game', 'player_build_projection_v1',
  'private canonical build projection exists');
select ok(not has_function_privilege(
  'service_role', 'game.player_build_projection_v1(uuid)', 'execute'
), 'service role cannot bypass public home/start build projections');
select has_column('game', 'player_onboarding', 'initial_training_resolved_at',
  'guided stat decision is persisted even when deferred');
select has_function('game', 'normalize_player_action_v1',
  'private profile action normalizer exists');
select has_function('game', 'guard_player_action_token',
  'profile token immutability guard exists');
select has_trigger('game', 'player_action_tokens', 'player_action_tokens_guard',
  'profile action token bindings are immutable after preparation');
select ok(not has_function_privilege(
  'service_role', 'game.normalize_player_action_v1(jsonb)', 'execute'
) and not has_function_privilege(
  'service_role', 'game.guard_player_action_token()', 'execute'
), 'service role cannot execute private profile action helpers');

select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v2', 'player_home_v1', 'start_run_v3', 'run_view_v2',
      'prepare_action_v2', 'resolve_choice_v2', 'advance_day_v2',
      'prepare_player_action_v1', 'resolve_player_action_v1', 'request_run_render_v2'
    ) and p.prosecdef), 10, 'all Phase 4A RPCs are security definer');

select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v2', 'player_home_v1', 'start_run_v3', 'run_view_v2',
      'prepare_action_v2', 'resolve_choice_v2', 'advance_day_v2',
      'prepare_player_action_v1', 'resolve_player_action_v1', 'request_run_render_v2'
    ) and p.proconfig @> array['search_path=pg_catalog, game, pg_temp']),
  10, 'all Phase 4A RPCs pin the safe search path');

select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v2', 'player_home_v1', 'start_run_v3', 'run_view_v2',
      'prepare_action_v2', 'resolve_choice_v2', 'advance_day_v2',
      'prepare_player_action_v1', 'resolve_player_action_v1', 'request_run_render_v2'
    ) and r.rolname = 'postgres'), 10, 'postgres owns all Phase 4A RPCs');

select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v2', 'player_home_v1', 'start_run_v3', 'run_view_v2',
      'prepare_action_v2', 'resolve_choice_v2', 'advance_day_v2',
      'prepare_player_action_v1', 'resolve_player_action_v1', 'request_run_render_v2'
    ) and has_function_privilege('service_role', p.oid, 'execute')),
  10, 'service role can execute exact Phase 4A RPCs');

select is((select count(*)::integer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'telegram_identity_v2', 'player_home_v1', 'start_run_v3', 'run_view_v2',
      'prepare_action_v2', 'resolve_choice_v2', 'advance_day_v2',
      'prepare_player_action_v1', 'resolve_player_action_v1', 'request_run_render_v2'
    ) and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon and authenticated cannot execute Phase 4A RPCs');

select col_is_unique('game', 'player_rings', 'player_id',
  'a player has at most one starter ring in Phase 4A');
select col_is_unique('game', 'processed_player_actions', 'telegram_update_id',
  'profile update IDs are unique in their namespace');
select col_is_unique('game', 'player_equipment', array['player_id', 'slot']::name[],
  'equipment has one current item per slot');
select ok(exists(
  select 1 from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'game'
    and c.relname = 'tutorial_run_assignments_one_credit_idx'
    and i.indisunique
    and pg_get_expr(i.indpred, i.indrelid) = '(credited_at IS NOT NULL)'
), 'tutorial attempts may repeat but each ordinal can be credited only once');
select col_is_unique('game', 'player_offers',
  array['player_id', 'source_run_id', 'sequence']::name[],
  'tutorial offers have stable order');
select has_trigger('game', 'progression_config_versions',
  'progression_config_versions_immutable', 'progression config is immutable');

select is((select count(*)::integer
  from information_schema.columns
  where table_schema = 'game'
    and table_name in (
      'player_onboarding', 'player_stat_progression', 'tutorial_run_assignments',
      'player_equipment', 'player_rings', 'player_offers', 'player_action_tokens',
      'processed_player_actions'
    ) and column_name in (
      'telegram_id', 'external_id', 'username', 'display_name', 'message_text', 'callback_token'
    )), 0, 'Phase 4A tables contain no Telegram PII or raw callback columns');

select * from finish();
rollback;
