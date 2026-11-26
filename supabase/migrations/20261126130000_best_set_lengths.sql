-- New challenge sheet (rebrand frame 21): best-set lengths are 1 day, 3 days and 1 week.
-- Config only. The default stays 24 hours and the max stays 168 hours, so create_challenge is unchanged.
update public.app_settings
set value = value || jsonb_build_object('deadline_options_hours', '[24, 72, 168]'::jsonb)
where key = 'async_battle_defaults';
