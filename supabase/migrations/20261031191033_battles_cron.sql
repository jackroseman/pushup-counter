-- Battle housekeeping: finalize (expire invites, complete battles, LOCK results) every minute.
-- pg_cron ships with Supabase; on the free plan it costs nothing extra.
create extension if not exists pg_cron;

select cron.schedule('finalize-battles', '* * * * *', $$ select public.finalize_battles(); $$);
