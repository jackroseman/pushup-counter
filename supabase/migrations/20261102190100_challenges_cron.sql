-- Reschedule the minute job onto the renamed function. Local tests skip *_cron.sql.
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'finalize-battles') then
    perform cron.unschedule('finalize-battles');
  end if;
end $$;

select cron.schedule('finalize-challenges', '* * * * *', $$ select public.finalize_challenges(); $$);
