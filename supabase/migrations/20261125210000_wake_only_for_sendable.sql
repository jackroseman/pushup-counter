-- The pg_cron safety net ('notify-drain', every minute) wakes the notify function whenever
-- private.has_unsent_notifications() is true. It used to check only sent_at is null, so a
-- row that had expired (failed_at set after 1 day) or was still held (quiet hours,
-- not_before in the future, an active lease) kept waking notify every minute until the
-- 30-day cleanup deleted it. Each wake is an HTTP call from pg_net, which is where the
-- wake_notify DNS timeouts came from.
--
-- Now it is true only when a drain could do something:
--   * a row public.lease_notifications() would hand out right now (same filters: not sent,
--     not failed, lease free, not_before passed, recipient outside quiet hours), or
--   * a row that private.expire_notifications() would mark failed (open, not_before passed,
--     older than 1 day), so one drain retires it and the wakes stop.
create or replace function private.has_unsent_notifications()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.notification_outbox o
     where o.sent_at is null
       and o.failed_at is null
       and (o.not_before is null or o.not_before <= now())
       and (
         o.created_at <= now() - interval '1 day'
         or ((o.leased_until is null or o.leased_until <= now())
             and not coalesce(private.in_quiet(o.user_id, now()), false))
       )
  );
$$;
revoke all on function private.has_unsent_notifications() from public, anon, authenticated;
