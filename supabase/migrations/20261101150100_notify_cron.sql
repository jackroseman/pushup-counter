-- Push delivery: every minute, if the notification outbox has unsent rows, wake the
-- `notify` Edge Function with {"drain": true}. The function claims the rows, writes the
-- text, and sends them through Expo. (App actions and the submit-set function also wake it
-- right away, so this is the safety net, not the main path.)
-- The URL is registered by the notify function itself (public.register_notify_url) the
-- first time it runs, so no project ref or key lives in a migration. Until then this job
-- does nothing.
-- Skipped by the PGlite DB tests (*_cron.sql): pg_net and pg_cron aren't available there.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function private.wake_notify()
returns void language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  select value into u from private.server_config where key = 'notify_url';
  if u is null or not private.has_unsent_notifications() then return; end if;
  perform net.http_post(url := u, body := '{"drain": true}'::jsonb,
                        headers := '{"Content-Type": "application/json"}'::jsonb,
                        timeout_milliseconds := 5000);
end $$;
revoke all on function private.wake_notify() from public, anon, authenticated;

select cron.schedule('notify-drain', '* * * * *', $$ select private.wake_notify(); $$);
