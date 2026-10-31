-- Battles: hardening from the Supabase security / performance advisors (staging, 2026-10-31).

-- 1. Pin search_path on the remaining functions (lint 0011).
alter function public.server_now() set search_path = '';
alter function public.tg_battle_results_immutable() set search_path = '';
alter function public.depth_ratio(double precision, double precision, double precision) set search_path = '';
alter function public.tempo_score(bigint, numeric, numeric) set search_path = '';

-- 2. RLS helper functions move to a schema the Data API does not expose (lints 0028/0029).
--    Policies reference functions by OID, so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter function public.is_battle_member(uuid) set schema private;
alter function public.are_friends(uuid, uuid) set schema private;
alter function public.can_join_battle_channel(text) set schema private;

-- 3. Internal SECURITY DEFINER functions are not callable through the API.
--    ensure_detector_config stays executable: the security-invoker submit_set() calls it.
--    (Trigger functions only need EXECUTE when the trigger is created; pg_cron runs as postgres.)
revoke execute on function public.finalize_battles() from public, anon, authenticated;
revoke execute on function public.tg_battle_add_creator() from public, anon, authenticated;
revoke execute on function public.tg_battle_defaults() from public, anon, authenticated;
revoke execute on function public.tg_participant_after() from public, anon, authenticated;
revoke execute on function public.tg_participant_guard() from public, anon, authenticated;
revoke execute on function public.tg_set_battle_guard() from public, anon, authenticated;
revoke execute on function public.tg_battle_results_immutable() from public, anon, authenticated;

-- app_settings is readable by anon/authenticated through RLS, so setting() needs no elevation.
alter function public.setting(text) security invoker;

-- 4. Cover foreign keys with indexes (lint 0001).
create index if not exists battle_invite_links_created_by_idx on public.battle_invite_links (created_by);
create index if not exists battle_participants_invite_link_token_idx on public.battle_participants (invite_link_token);
create index if not exists battle_participants_invited_by_idx on public.battle_participants (invited_by);
create index if not exists battle_results_best_set_idx on public.battle_results (best_set_id);
create index if not exists friendships_requested_by_idx on public.friendships (requested_by);
create index if not exists set_flags_flagged_by_idx on public.set_flags (flagged_by);
create index if not exists sets_detector_config_idx on public.sets (detector_config_id);
create index if not exists sets_device_idx on public.sets (device_id);
