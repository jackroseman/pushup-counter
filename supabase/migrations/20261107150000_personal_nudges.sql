-- Slice 7: personal nudges. Expand-only for the app that is already installed.
-- notification_prefs is a new table. dedupe_key defaults to '' so rows that were
-- unique before stay unique. Old outbox kinds stay valid. claim_notifications keeps
-- its arguments and its result columns, and it only claims kinds the previous notify
-- function can send. Quiet hours and not_before only delay a row. sent_at is set
-- only after a push was attempted with real text.

insert into public.app_settings (key, value, description) values
  ('notification_defaults',
   '{"daily_nudge": true, "pass_ping": true, "weekly_recap": true, "quiet_start": "21:00", "quiet_end": "08:00", "nudge_local_time": "18:00", "recap_weekday": 7, "recap_local_time": "18:00"}',
   'Quiet hours, 18:00 daily nudge, Sunday 18:00 recap, all three nudges on. A missing notification_prefs row uses this.')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

create table public.notification_prefs (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  daily_nudge      boolean not null default true,
  pass_ping        boolean not null default true,
  weekly_recap     boolean not null default true,
  quiet_start      time not null default '21:00',
  quiet_end        time not null default '08:00',
  nudge_local_time time not null default '18:00',
  recap_weekday    smallint not null default 7 check (recap_weekday between 1 and 7),
  recap_local_time time not null default '18:00',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function private.tg_notification_prefs_touch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger notification_prefs_touch
  before update on public.notification_prefs
  for each row execute function private.tg_notification_prefs_touch();

alter table public.notification_prefs enable row level security;

create policy notification_prefs_select on public.notification_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notification_prefs_insert on public.notification_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy notification_prefs_update on public.notification_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notification_prefs_delete on public.notification_prefs
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.notification_prefs from public, anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;

-- Existing accounts start at this migration. New accounts start when the profile is created.
-- A pass ping only fires for a crossing set received at or after that instant.
create or replace function private.tg_profile_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger profile_notification_prefs
  after insert on public.profiles
  for each row execute function private.tg_profile_notification_prefs();

insert into public.notification_prefs (user_id)
select id from public.profiles
on conflict do nothing;

alter table private.notification_outbox
  add column dedupe_key text not null default '',
  add column not_before timestamptz,
  add column failed_at timestamptz,
  add column leased_until timestamptz;

do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'private.notification_outbox'::regclass
     and contype = 'u';
  if cname is not null then
    execute format('alter table private.notification_outbox drop constraint %I', cname);
  end if;
end $$;

alter table private.notification_outbox
  add constraint notification_outbox_dedupe_key
  unique nulls not distinct (kind, user_id, challenge_id, actor_id, dedupe_key);

alter table private.notification_outbox drop constraint notification_outbox_kind_check;
alter table private.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'friend_request', 'friend_accepted', 'challenge_invite',
    'invite_accepted', 'invite_declined', 'set_submitted', 'challenge_result',
    'challenge_expired', 'challenge_cancelled', 'challenge_reminder', 'challenge_reminder_half',
    'daily_nudge', 'pass_ping', 'weekly_recap'
  ));

-- -------------------------------------------------------------------------------------
-- Effective prefs. No row means notification_defaults.
-- -------------------------------------------------------------------------------------
create or replace function private.nudge_pref(p_user uuid)
returns table (
  daily_nudge boolean,
  pass_ping boolean,
  weekly_recap boolean,
  quiet_start time,
  quiet_end time,
  nudge_local_time time,
  recap_weekday smallint,
  recap_local_time time
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(n.daily_nudge, coalesce((d.defaults->>'daily_nudge')::boolean, true)),
    coalesce(n.pass_ping, coalesce((d.defaults->>'pass_ping')::boolean, true)),
    coalesce(n.weekly_recap, coalesce((d.defaults->>'weekly_recap')::boolean, true)),
    coalesce(n.quiet_start, coalesce((d.defaults->>'quiet_start')::time, '21:00'::time)),
    coalesce(n.quiet_end, coalesce((d.defaults->>'quiet_end')::time, '08:00'::time)),
    coalesce(n.nudge_local_time, coalesce((d.defaults->>'nudge_local_time')::time, '18:00'::time)),
    coalesce(n.recap_weekday, coalesce((d.defaults->>'recap_weekday')::smallint, 7::smallint)),
    coalesce(n.recap_local_time, coalesce((d.defaults->>'recap_local_time')::time, '18:00'::time))
  from (select coalesce(public.setting('notification_defaults'), '{}'::jsonb) as defaults) d
  left join public.notification_prefs n on n.user_id = p_user;
$$;

create or replace function private.time_in_quiet(p_at time, p_start time, p_end time)
returns boolean
language sql
immutable
as $$
  select case
    when p_start = p_end then false
    when p_start < p_end then p_at >= p_start and p_at < p_end
    else p_at >= p_start or p_at < p_end
  end;
$$;

create or replace function private.in_quiet(p_user uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.time_in_quiet(
           (p_at at time zone coalesce(nullif(btrim(p.time_zone), ''), 'UTC'))::time,
           pref.quiet_start,
           pref.quiet_end)
    from public.profiles p
    join lateral private.nudge_pref(p.id) pref on true
   where p.id = p_user;
$$;

-- -------------------------------------------------------------------------------------
-- The same friend board my_league ranks, at a chosen instant. Private: it returns
-- aggregates to the nudge queue, not to the client.
-- -------------------------------------------------------------------------------------
create or replace function private.league_board(p_user uuid, p_as_of timestamptz)
returns table (
  user_id uuid,
  week_start date,
  reps integer,
  points integer,
  hit integer,
  scheduled integer,
  usual numeric,
  total_rank integer,
  imp_rank integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weights jsonb;
  v_grace integer;
  v_per_rep numeric;
  v_per_goal integer;
  v_perfect integer;
  v_base integer;
  v_min integer;
  v_span integer;
begin
  if p_user is null then return; end if;
  v_weights := coalesce(public.setting('league_improvement_weights'),
    '{"per_rep_above_usual":1,"per_goal_day":20,"perfect_week":30,"baseline_weeks":8,"baseline_min_weeks":3}'::jsonb);
  v_grace := least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400);
  v_per_rep := greatest(coalesce((v_weights->>'per_rep_above_usual')::numeric, 1), 0);
  v_per_goal := least(greatest(coalesce((v_weights->>'per_goal_day')::integer, 20), 0), 100000);
  v_perfect := least(greatest(coalesce((v_weights->>'perfect_week')::integer, 30), 0), 100000);
  v_base := least(greatest(coalesce((v_weights->>'baseline_weeks')::integer, 8), 1), 52);
  v_min := least(greatest(coalesce((v_weights->>'baseline_min_weeks')::integer, 3), 1), v_base);
  v_span := (v_base + 1) * 7;

  return query
  with members as (
    select pr.id,
           coalesce(nullif(btrim(pr.time_zone), ''), 'UTC') as zone
    from public.profiles pr
    where pr.id = p_user
       or exists (
         select 1 from public.friendships f
         where f.status = 'accepted'
           and least(f.user_low, f.user_high) = least(p_user, pr.id)
           and greatest(f.user_low, f.user_high) = greatest(p_user, pr.id)
       )
  ),
  clock as (
    select m.id, m.zone,
           (p_as_of at time zone m.zone)::date as today,
           ((p_as_of at time zone m.zone)::date
             - (extract(isodow from (p_as_of at time zone m.zone)::date)::int - 1))::date as week_start
    from members m
  ),
  eligible as (
    select s.user_id,
           s.recorded_time_zone,
           (s.started_at at time zone s.recorded_time_zone)::date as local_date,
           sm.good_or_better_reps as reps,
           s.received_at
    from public.sets s
    join public.set_metrics sm on sm.set_id = s.id
    join members mem on mem.id = s.user_id
  ),
  days as (
    select e.user_id, e.local_date, sum(e.reps)::int as reps
    from eligible e
    where e.received_at <= (
      ((e.local_date - (extract(isodow from e.local_date)::int - 1) + 7)::timestamp
        at time zone e.recorded_time_zone)
      + make_interval(secs => v_grace)
    )
    group by e.user_id, e.local_date
    having sum(e.reps) > 0
  ),
  firsts as (
    select d.user_id,
           (min(d.local_date) - (extract(isodow from min(d.local_date))::int - 1))::date as first_week
    from days d
    group by d.user_id
  ),
  week_reps as (
    select c.id as user_id, w.week_start::date as week_start, coalesce(sum(d.reps), 0)::int as reps
    from clock c
    join lateral generate_series(
      (c.week_start - v_span)::timestamp,
      c.week_start::timestamp,
      interval '7 days'
    ) as w(week_start) on true
    left join days d
      on d.user_id = c.id
     and d.local_date >= w.week_start::date
     and d.local_date < w.week_start::date + 7
    group by c.id, w.week_start
  ),
  refs as (
    select c.id as user_id, c.week_start as ref_week from clock c
  ),
  samples as (
    select wr.user_id, ref.ref_week, wr.reps,
           row_number() over (partition by wr.user_id, ref.ref_week order by wr.week_start desc) as n
    from week_reps wr
    join refs ref on ref.user_id = wr.user_id
    join firsts f on f.user_id = wr.user_id
    where wr.week_start < ref.ref_week
      and wr.week_start >= f.first_week
  ),
  usual_for as (
    select s.user_id, s.ref_week,
           case when count(*) >= v_min then percentile_cont(0.5) within group (order by s.reps) end as usual
    from samples s
    where s.n <= v_base
    group by s.user_id, s.ref_week
  ),
  day_rows as (
    select c.id as user_id,
           gs.day::date as local_date,
           c.week_start as bucket,
           c.today,
           coalesce(d.reps, 0)::int as reps,
           case
             when enr.custom_daily_reps is not null then enr.custom_daily_reps
             when seg.daily_target is null then null
             when seg.rest_weekday is not null and extract(isodow from gs.day::date)::int = seg.rest_weekday then 0
             else seg.daily_target
           end as target
    from clock c
    join lateral generate_series(c.week_start::timestamp, (c.week_start + 6)::timestamp, interval '1 day') as gs(day) on true
    left join days d on d.user_id = c.id and d.local_date = gs.day::date
    left join lateral (
      select e.custom_daily_reps, e.program_id, e.started_on
      from public.goal_enrollments e
      where e.user_id = c.id
        and e.started_on <= gs.day::date
        and (e.ended_on is null or gs.day::date < e.ended_on)
      order by e.started_on desc
      limit 1
    ) enr on true
    left join lateral (
      select seg.daily_target, seg.rest_weekday
      from public.program_segments seg
      join public.programs pr on pr.id = seg.program_id
      where enr.program_id is not null
        and seg.program_id = enr.program_id
        and (
          ((gs.day::date - enr.started_on) + 1) between seg.day_from and seg.day_to
          or (
            pr.maintains_after
            and ((gs.day::date - enr.started_on) + 1) > (
              select max(day_to) from public.program_segments where program_id = enr.program_id
            )
            and seg.day_to = (select max(day_to) from public.program_segments where program_id = enr.program_id)
          )
        )
      order by seg.segment_index
      limit 1
    ) seg on true
  ),
  week_goals as (
    select dr.user_id, dr.bucket,
           count(*) filter (where dr.target > 0)::int as scheduled,
           count(*) filter (where dr.target > 0 and dr.local_date <= dr.today and dr.reps >= dr.target)::int as hit
    from day_rows dr
    group by dr.user_id, dr.bucket
  ),
  scores as (
    select c.id as user_id, c.week_start,
           coalesce(wr.reps, 0)::int as reps,
           coalesce(g.scheduled, 0)::int as scheduled,
           coalesce(g.hit, 0)::int as hit,
           u.usual,
           (
             (case when u.usual is null then 0
                   else floor(greatest(0, coalesce(wr.reps, 0) - u.usual) * v_per_rep)::int end)
             + (coalesce(g.hit, 0) * v_per_goal)
             + (case
                  when c.today >= c.week_start + 7
                   and coalesce(g.scheduled, 0) > 0
                   and coalesce(g.hit, 0) = g.scheduled
                  then v_perfect else 0 end)
           )::int as points
    from clock c
    left join week_reps wr on wr.user_id = c.id and wr.week_start = c.week_start
    left join week_goals g on g.user_id = c.id and g.bucket = c.week_start
    left join usual_for u on u.user_id = c.id and u.ref_week = c.week_start
  ),
  ranked as (
    select s.*,
           rank() over (order by s.reps desc)::int as total_rank,
           rank() over (order by s.points desc, s.hit desc, s.reps desc)::int as imp_rank
    from scores s
  )
  select r.user_id, r.week_start, r.reps, r.points, r.hit, r.scheduled, r.usual::numeric, r.total_rank, r.imp_rank
    from ranked r;
end $$;

-- The set that first put this friend strictly ahead of the recipient's current number.
-- Total and improvement are separate. A week starts at zero, so a lead always has one.
create or replace function private.lead_set(
  p_friend uuid,
  p_as_of timestamptz,
  p_mine_reps integer,
  p_mine_points integer
)
returns table (total_set uuid, improvement_set uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_weights jsonb;
  v_grace integer;
  v_per_rep numeric;
  v_per_goal integer;
  v_perfect integer;
  v_zone text;
  v_today date;
  v_week date;
  v_usual numeric;
  v_running integer := 0;
  v_hit integer;
  v_scheduled integer;
  v_points integer;
  v_total uuid;
  v_imp uuid;
  s record;
  d record;
begin
  v_weights := coalesce(public.setting('league_improvement_weights'),
    '{"per_rep_above_usual":1,"per_goal_day":20,"perfect_week":30,"baseline_weeks":8,"baseline_min_weeks":3}'::jsonb);
  v_grace := least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400);
  v_per_rep := greatest(coalesce((v_weights->>'per_rep_above_usual')::numeric, 1), 0);
  v_per_goal := least(greatest(coalesce((v_weights->>'per_goal_day')::integer, 20), 0), 100000);
  v_perfect := least(greatest(coalesce((v_weights->>'perfect_week')::integer, 30), 0), 100000);
  select b.week_start, b.usual into v_week, v_usual
    from private.league_board(p_friend, p_as_of) b
   where b.user_id = p_friend;
  if v_week is null then
    total_set := null;
    improvement_set := null;
    return next;
    return;
  end if;
  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = p_friend;
  v_today := (p_as_of at time zone v_zone)::date;

  create temporary table if not exists pg_temp.lead_days (
    local_date date primary key,
    target integer,
    reps integer
  ) on commit drop;
  delete from pg_temp.lead_days;

  insert into pg_temp.lead_days (local_date, target, reps)
  select gs::date,
         case
           when enr.custom_daily_reps is not null then enr.custom_daily_reps
           when seg.daily_target is null then null
           when seg.rest_weekday is not null and extract(isodow from gs::date)::int = seg.rest_weekday then 0
           else seg.daily_target
         end,
         0
  from generate_series(v_week::timestamp, (v_week + 6)::timestamp, interval '1 day') gs
  left join lateral (
    select e.custom_daily_reps, e.program_id, e.started_on
    from public.goal_enrollments e
    where e.user_id = p_friend
      and e.started_on <= gs::date
      and (e.ended_on is null or gs::date < e.ended_on)
    order by e.started_on desc
    limit 1
  ) enr on true
  left join lateral (
    select seg.daily_target, seg.rest_weekday
    from public.program_segments seg
    join public.programs pr on pr.id = seg.program_id
    where enr.program_id is not null
      and seg.program_id = enr.program_id
      and (
        ((gs::date - enr.started_on) + 1) between seg.day_from and seg.day_to
        or (
          pr.maintains_after
          and ((gs::date - enr.started_on) + 1) > (
            select max(day_to) from public.program_segments where program_id = enr.program_id
          )
          and seg.day_to = (select max(day_to) from public.program_segments where program_id = enr.program_id)
        )
      )
    order by seg.segment_index
    limit 1
  ) seg on true;

  select count(*) filter (where target > 0)::int into v_scheduled from pg_temp.lead_days;

  for s in
    select st.id, st.started_at,
           (st.started_at at time zone st.recorded_time_zone)::date as local_date,
           sm.good_or_better_reps as reps
    from public.sets st
    join public.set_metrics sm on sm.set_id = st.id
    where st.user_id = p_friend
      and sm.good_or_better_reps > 0
      and (st.started_at at time zone st.recorded_time_zone)::date >= v_week
      and (st.started_at at time zone st.recorded_time_zone)::date < v_week + 7
      and st.received_at <= (
        (((st.started_at at time zone st.recorded_time_zone)::date
          - (extract(isodow from (st.started_at at time zone st.recorded_time_zone)::date)::int - 1) + 7)::timestamp
          at time zone st.recorded_time_zone)
        + make_interval(secs => v_grace)
      )
    order by st.started_at, st.id
  loop
    v_running := v_running + s.reps;
    update pg_temp.lead_days set reps = reps + s.reps where local_date = s.local_date;
    select count(*) filter (where target > 0 and local_date <= v_today and reps >= target)::int
      into v_hit from pg_temp.lead_days;
    v_points :=
      (case when v_usual is null then 0 else floor(greatest(0, v_running - v_usual) * v_per_rep)::int end)
      + (coalesce(v_hit, 0) * v_per_goal)
      + (case when v_today >= v_week + 7 and coalesce(v_scheduled, 0) > 0 and coalesce(v_hit, 0) = v_scheduled
              then v_perfect else 0 end);
    if v_total is null and v_running > p_mine_reps then v_total := s.id; end if;
    if v_imp is null and v_points > p_mine_points then v_imp := s.id; end if;
  end loop;

  total_set := v_total;
  improvement_set := v_imp;
  return next;
end $$;

create or replace function private.queue_personal_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  pal record;
  me record;
  led record;
  v_zone text;
  v_live timestamptz;
  v_today date;
  v_week date;
  v_local time;
  pref record;
  v_due timestamptz;
begin
  -- Daily reminder: a goal, a real target, no counted reps yet, and a push token.
  -- Someone without a token gets the on-phone reminder instead.
  for r in
    select p.id
    from public.profiles p
    where exists (
      select 1 from public.push_tokens t
      join public.devices d on d.id = t.device_id
      where d.user_id = p.id and t.disabled_at is null
    )
  loop
    select * into pref from private.nudge_pref(r.id);
    select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = r.id;
    v_today := (now() at time zone v_zone)::date;
    v_local := (now() at time zone v_zone)::time;
    v_week := (v_today - (extract(isodow from v_today)::int - 1));

    if pref.daily_nudge and v_local >= pref.nudge_local_time then
      if exists (
           select 1 from public.goal_for_date g
            where g.user_id = r.id and g.local_date = v_today
              and g.target_reps > 0 and g.rest = false
         )
         and coalesce((
           select dt.counted_reps from public.daily_totals dt
            where dt.user_id = r.id and dt.local_date = v_today
         ), 0) = 0
      then
        v_due := (v_today::timestamp + pref.nudge_local_time) at time zone v_zone;
        insert into private.notification_outbox (kind, user_id, dedupe_key, not_before)
        values ('daily_nudge', r.id, to_char(v_today, 'YYYY-MM-DD'), v_due)
        on conflict do nothing;
      end if;
    end if;

    if pref.weekly_recap
       and extract(isodow from v_today)::int = pref.recap_weekday
       and v_local >= pref.recap_local_time
    then
      v_due := (v_today::timestamp + pref.recap_local_time) at time zone v_zone;
      insert into private.notification_outbox (kind, user_id, dedupe_key, not_before)
      values ('weekly_recap', r.id, to_char(v_week, 'YYYY-MM-DD'), v_due)
      on conflict do nothing;
    end if;

    -- A pass is a set that crosses after this account's prefs exist. Someone who was
    -- already ahead when the feature went live does not get a backlog ping this week.
    if pref.pass_ping then
      select n.created_at into v_live from public.notification_prefs n where n.user_id = r.id;
      select * into me from private.league_board(r.id, now()) b where b.user_id = r.id;
      if v_live is not null and me.user_id is not null then
        for pal in
          select * from private.league_board(r.id, now()) b where b.user_id <> r.id
        loop
          if pal.reps > me.reps or pal.points > me.points then
            select * into led from private.lead_set(pal.user_id, now(), me.reps, me.points);
            if pal.reps > me.reps and led.total_set is not null
               and exists (
                 select 1 from public.sets s
                  where s.id = led.total_set and s.received_at >= v_live
               )
            then
              insert into private.notification_outbox (kind, user_id, actor_id, dedupe_key, not_before)
              values ('pass_ping', r.id, pal.user_id, 'total:' || to_char(me.week_start, 'YYYY-MM-DD'), now())
              on conflict do nothing;
            end if;
            -- The same set on both boards sends only the Total ping.
            if pal.points > me.points and led.improvement_set is not null
               and not (pal.reps > me.reps and led.total_set is not distinct from led.improvement_set)
               and exists (
                 select 1 from public.sets s
                  where s.id = led.improvement_set and s.received_at >= v_live
               )
            then
              insert into private.notification_outbox (kind, user_id, actor_id, dedupe_key, not_before)
              values ('pass_ping', r.id, pal.user_id, 'improvement:' || to_char(me.week_start, 'YYYY-MM-DD'), now())
              on conflict do nothing;
            end if;
          end if;
        end loop;
      end if;
    end if;
  end loop;
end $$;

-- The caller's ranks for one Monday, and nothing else. Friends' reps stay inside.
create or replace function public.my_recap_ranks(p_week date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_zone text;
  v_today date;
  v_current date;
  v_week date;
  v_as_of timestamptz;
  v_people integer;
  me record;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'pick a username first'; end if;
  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = v_user;
  v_today := (now() at time zone v_zone)::date;
  v_current := (v_today - (extract(isodow from v_today)::int - 1));
  v_week := coalesce(p_week, v_current);
  if v_week = v_current then
    v_as_of := now();
  else
    v_as_of := ((v_week + 7)::timestamp at time zone v_zone);
  end if;
  select count(*) into v_people from private.league_board(v_user, v_as_of);
  select * into me from private.league_board(v_user, v_as_of) b where b.user_id = v_user;
  if me.user_id is null then return null; end if;
  return jsonb_build_object(
    'weekStart', v_week,
    'totalRank', me.total_rank,
    'improvementRank', me.imp_rank,
    'friends', v_people >= 2,
    'totalCrown', v_people >= 2 and me.total_rank = 1
  );
end $$;

revoke all on function public.my_recap_ranks(date) from public, anon;
grant execute on function public.my_recap_ranks(date) to authenticated;

-- -------------------------------------------------------------------------------------
-- Window challenges: one set_submitted per actor per recipient per local day,
-- including a solo set that lands in the window. Best-set keeps dedupe_key ''.
-- -------------------------------------------------------------------------------------
create or replace function private.tg_notify_window_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sets;
  counted integer;
  v_grace interval := make_interval(secs => least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400));
begin
  select * into s from public.sets where id = new.set_id;
  if not found then return null; end if;
  select coalesce(sum(m.good_or_better_reps), 0) into counted
    from public.set_metrics m where m.set_id = s.id;
  if counted <= 0 then return null; end if;

  insert into private.notification_outbox (kind, user_id, challenge_id, actor_id, dedupe_key, not_before)
  select 'set_submitted', p.user_id, b.id, s.user_id,
         to_char((now() at time zone coalesce(nullif(btrim(pr.time_zone), ''), 'UTC'))::date, 'YYYY-MM-DD'),
         now()
  from public.challenges b
  join public.challenge_participants p
    on p.challenge_id = b.id
   and p.status in ('invited', 'accepted')
   and p.user_id is distinct from s.user_id
  join public.profiles pr on pr.id = p.user_id
  where b.kind in ('total', 'streak', 'team')
    and b.status in ('pending', 'active')
    and s.started_at >= b.starts_at
    and s.started_at < b.ends_at
    and (p.left_at is null or s.started_at < p.left_at)
    and s.received_at <= b.ends_at + v_grace
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists notify_window_set on public.reps;
create trigger notify_window_set
  after insert on public.reps
  for each row execute function private.tg_notify_window_set();

-- Window reminders go to people who are in and still on 0 counted reps.
create or replace function private.queue_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb := coalesce(public.setting('notifications'), '{}');
  v_hours numeric := coalesce((s->>'reminder_hours_before')::numeric, 2);
  v_half boolean := coalesce((s->>'reminder_at_half_time')::boolean, true);
  r record;
begin
  for r in
    select b.id, b.created_at, b.ends_at,
           array(select p.user_id from public.challenge_participants p
                  where p.challenge_id = b.id
                    and (p.status = 'accepted' or (p.status = 'invited' and b.invite_expires_at > now()))
                    and (select count(*) from public.sets x where x.challenge_id = b.id and x.user_id = p.user_id) < b.attempts_allowed
                ) as todo
      from public.challenges b
     where b.mode = 'async' and b.kind = 'best_set' and b.status in ('pending', 'active') and b.ends_at > now()
  loop
    if v_hours > 0 and now() >= r.ends_at - make_interval(secs => v_hours * 3600)
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 3600) then
      perform private.enqueue('challenge_reminder', r.todo, r.id, null);
    elsif v_half and now() >= r.created_at + (r.ends_at - r.created_at) / 2
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 2 * 3600) then
      perform private.enqueue('challenge_reminder_half', r.todo, r.id, null);
    end if;
  end loop;

  for r in
    select b.id, b.created_at, b.ends_at, b.starts_at,
           array(
             select p.user_id from public.challenge_participants p
              where p.challenge_id = b.id
                and (p.status = 'accepted' or (p.status = 'invited' and b.invite_expires_at > now()))
                and coalesce((
                  select sum(sm.good_or_better_reps)
                  from public.sets st
                  join public.set_metrics sm on sm.set_id = st.id
                  where st.user_id = p.user_id
                    and st.started_at >= b.starts_at
                    and st.started_at < b.ends_at
                    and (p.left_at is null or st.started_at < p.left_at)
                ), 0) = 0
           ) as todo
      from public.challenges b
     where b.mode = 'async'
       and b.kind in ('total', 'streak', 'team')
       and b.status in ('pending', 'active')
       and b.ends_at > now()
       and b.starts_at is not null
  loop
    if v_hours > 0 and now() >= r.ends_at - make_interval(secs => v_hours * 3600)
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 3600) then
      perform private.enqueue('challenge_reminder', r.todo, r.id, null);
    elsif v_half and now() >= r.created_at + (r.ends_at - r.created_at) / 2
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 2 * 3600) then
      perform private.enqueue('challenge_reminder_half', r.todo, r.id, null);
    end if;
  end loop;
end $$;

create or replace function public.finalize_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  r record;
  done boolean;
  entrants int;
  v_grace interval := make_interval(secs => least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400));
  v_still int;
  v_out int;
  v_team integer;
  v_day_closed boolean;
begin
  update public.challenge_participants bp set status = 'expired'
    from public.challenges b
   where b.id = bp.challenge_id and bp.status = 'invited' and b.invite_expires_at <= now();

  update public.challenges set status = 'expired', finished_at = now()
   where status = 'pending' and invite_expires_at <= now()
     and not exists (select 1 from public.challenge_participants p
                      where p.challenge_id = challenges.id and p.status = 'accepted'
                        and p.user_id is distinct from challenges.created_by)
     and not exists (select 1 from public.challenge_invite_links l
                      where l.challenge_id = challenges.id and l.revoked_at is null and l.expires_at > now());

  update public.challenges set status = 'expired', finished_at = now()
   where status = 'pending' and ends_at is not null and ends_at <= now();

  for r in select * from public.challenges where status = 'active' for update skip locked loop
    v_still := 0;
    v_out := 0;
    v_team := 0;
    v_day_closed := false;
    if r.kind = 'streak' then
      select count(*) filter (where l.participant_status = 'accepted' and l.eliminated_on is null),
             count(*) filter (where l.eliminated_on is not null)
        into v_still, v_out
        from public.challenge_standings_live l
       where l.challenge_id = r.id;
      v_day_closed := now() > (
        (((r.starts_at at time zone coalesce(r.anchor_time_zone, 'UTC'))::date + 1)::timestamp
          at time zone coalesce(r.anchor_time_zone, 'UTC')) + v_grace);
    elsif r.kind = 'team' then
      select coalesce(max(l.team_total), 0) into v_team
        from public.challenge_standings_live l
       where l.challenge_id = r.id;
    end if;
    done := case
      when r.mode = 'live' and r.starts_at is null then
        now() > r.activated_at + interval '15 minutes'
      when r.mode = 'live' then
        (
          now() > r.starts_at + make_interval(secs => coalesce(r.duration_s, 600)) + v_grace
          or not exists (select 1 from public.challenge_participants p where p.challenge_id = r.id and p.status = 'accepted'
                           and not exists (select 1 from public.sets s where s.challenge_id = r.id and s.user_id = p.user_id)))
      when r.kind = 'best_set' then
        now() > r.ends_at + v_grace
        or (not exists (select 1 from public.challenge_participants p where p.challenge_id = r.id and p.status = 'accepted'
                         and (select count(*) from public.sets s where s.challenge_id = r.id and s.user_id = p.user_id) < r.attempts_allowed)
            and not exists (select 1 from public.challenge_participants p where p.challenge_id = r.id and p.status = 'invited')
            and not exists (select 1 from public.challenge_invite_links l
                             where l.challenge_id = r.id and l.revoked_at is null and l.expires_at > now()
                               and (select count(*) from public.challenge_participants u where u.invite_link_token = l.token) < l.max_uses
                               and (select count(*) from public.challenge_participants u
                                     where u.challenge_id = r.id and u.status in ('invited', 'accepted')) < r.max_participants))
      when r.kind = 'total' then now() > r.ends_at + v_grace
      when r.kind = 'streak' then
        now() > r.ends_at + v_grace
        or v_still = 0
        or (v_still = 1 and v_out >= 1 and v_day_closed)
      when r.kind = 'team' then
        now() > r.ends_at + v_grace
        or v_team >= r.target_reps
      else false
    end;
    if done then
      if r.kind = 'best_set' then
        select count(distinct user_id) into entrants from public.sets where challenge_id = r.id;
      else
        select count(*) into entrants from public.challenge_participants
         where challenge_id = r.id and status in ('accepted', 'forfeited');
      end if;
      update public.challenges
         set status = case when entrants >= 2 then 'completed'::public.challenge_status else 'expired'::public.challenge_status end,
             finished_at = now()
       where id = r.id;
      if entrants >= 2 then
        insert into public.challenge_results (challenge_id, user_id, participant_status, best_set_id,
               valid_reps, avg_depth_pct, tempo_score, metric_value, rank, is_winner,
               metric, scoring_version, attempts_used, kind,
               days_survived, eliminated_on, team_total, team_target)
        select l.challenge_id, l.user_id, l.participant_status, l.best_set_id,
               l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value, l.rank,
               case
                 when r.kind = 'best_set' then
                   (l.metric_value is not null and l.rank = 1
                    and (select count(*) from public.challenge_standings_live d
                          where d.challenge_id = r.id and d.rank = 1) = 1)
                 when r.kind = 'team' then
                   (l.participant_status = 'accepted' and coalesce(l.team_total, 0) >= r.target_reps)
                 when r.kind = 'streak' then
                   (l.participant_status = 'accepted' and l.rank = 1
                    and (select count(*) from public.challenge_standings_live d
                          where d.challenge_id = r.id and d.rank = 1) = 1)
                 else
                   (l.participant_status = 'accepted' and l.metric_value is not null and l.rank = 1
                    and (select count(*) from public.challenge_standings_live d
                          where d.challenge_id = r.id and d.rank = 1 and d.participant_status = 'accepted') = 1)
               end,
               coalesce(r.metric, 'rep_count'), r.scoring_version, l.attempts_used, r.kind,
               l.days_survived, l.eliminated_on, l.team_total, l.team_target
          from public.challenge_standings_live l
         where l.challenge_id = r.id;
      end if;
      n := n + 1;
    end if;
  end loop;

  perform private.queue_reminders();
  perform private.queue_personal_nudges();
  return n;
end $$;

-- -------------------------------------------------------------------------------------
-- Facts at send time, including the personal nudges. dedupe_key says which week or day.
-- -------------------------------------------------------------------------------------
create or replace function private.daily_nudge_facts(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'target', g.target_reps,
    'reps', coalesce(dt.counted_reps, 0),
    'rest', coalesce(g.rest, false)
  )
  from public.profiles p
  left join public.goal_for_date g
    on g.user_id = p.id
   and g.local_date = (now() at time zone coalesce(nullif(btrim(p.time_zone), ''), 'UTC'))::date
  left join public.daily_totals dt
    on dt.user_id = p.id
   and dt.local_date = (now() at time zone coalesce(nullif(btrim(p.time_zone), ''), 'UTC'))::date
  where p.id = p_user;
$$;

create or replace function private.pass_facts(p_user uuid, p_actor uuid, p_dedupe text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_board text := split_part(p_dedupe, ':', 1);
  v_week date;
  v_zone text;
  v_current date;
  v_as_of timestamptz;
  me record;
  pal record;
begin
  if split_part(p_dedupe, ':', 2) !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  v_week := split_part(p_dedupe, ':', 2)::date;
  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = p_user;
  v_current := ((now() at time zone v_zone)::date - (extract(isodow from (now() at time zone v_zone)::date)::int - 1));
  if v_week = v_current then v_as_of := now();
  else v_as_of := ((v_week + 7)::timestamp at time zone v_zone);
  end if;
  select * into me from private.league_board(p_user, v_as_of) b where b.user_id = p_user;
  select * into pal from private.league_board(p_user, v_as_of) b where b.user_id = p_actor;
  if me.user_id is null or pal.user_id is null then return null; end if;
  return jsonb_build_object(
    'board', case when v_board = 'improvement' then 'improvement' else 'total' end,
    'theirs', case when v_board = 'improvement' then pal.points else pal.reps end,
    'mine', case when v_board = 'improvement' then me.points else me.reps end
  );
end $$;

create or replace function private.recap_facts(p_user uuid, p_dedupe text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_week date;
  v_zone text;
  v_current date;
  v_as_of timestamptz;
  v_reps integer;
  v_hit integer;
  v_scheduled integer;
  v_people integer;
  me record;
begin
  if p_dedupe !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  v_week := p_dedupe::date;
  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = p_user;
  v_current := ((now() at time zone v_zone)::date - (extract(isodow from (now() at time zone v_zone)::date)::int - 1));
  if v_week = v_current then v_as_of := now();
  else v_as_of := ((v_week + 7)::timestamp at time zone v_zone);
  end if;
  select coalesce(sum(dt.counted_reps), 0) into v_reps
    from public.daily_totals dt
   where dt.user_id = p_user and dt.local_date >= v_week and dt.local_date < v_week + 7;
  select count(*) filter (where g.target_reps > 0),
         count(*) filter (where g.target_reps > 0 and g.local_date <= (v_as_of at time zone v_zone)::date
                            and coalesce(dt.counted_reps, 0) >= g.target_reps)
    into v_scheduled, v_hit
    from public.goal_for_date g
    left join public.daily_totals dt on dt.user_id = g.user_id and dt.local_date = g.local_date
   where g.user_id = p_user and g.local_date >= v_week and g.local_date < v_week + 7;
  select count(*) into v_people from private.league_board(p_user, v_as_of);
  select * into me from private.league_board(p_user, v_as_of) b where b.user_id = p_user;
  return jsonb_build_object(
    'reps', coalesce(v_reps, 0),
    'goalDaysHit', coalesce(v_hit, 0),
    'goalDaysScheduled', coalesce(v_scheduled, 0),
    'totalRank', me.total_rank,
    'improvementRank', me.imp_rank,
    'friends', v_people >= 2,
    'totalCrown', v_people >= 2 and me.total_rank = 1
  );
end $$;

drop function public.claim_notifications(integer);
drop function private.notification_facts(text, uuid, uuid, uuid);

create function private.notification_facts(
  p_kind text,
  p_user uuid,
  p_battle uuid,
  p_actor uuid,
  p_dedupe text default ''
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'timeZone', (select time_zone from public.profiles where id = p_user),
    'actor', (select jsonb_build_object('username', username, 'displayName', display_name)
                from public.profiles where id = p_actor),
    'nudge', case when p_kind = 'daily_nudge' then private.daily_nudge_facts(p_user) end,
    'pass', case when p_kind = 'pass_ping' then private.pass_facts(p_user, p_actor, p_dedupe) end,
    'recap', case when p_kind = 'weekly_recap' then private.recap_facts(p_user, p_dedupe) end,
    'challenge', (select jsonb_build_object(
                        'id', b.id, 'kind', b.kind, 'windowUnit', b.window_unit,
                        'metric', b.metric, 'durationS', b.duration_s, 'status', b.status, 'endsAt', b.ends_at,
                        'creator', (select username from public.profiles where id = b.created_by),
                        'creatorIsMe', b.created_by = p_user,
                        'mySetDone', case
                          when b.kind = 'best_set' then exists (
                            select 1 from public.sets x where x.challenge_id = b.id and x.user_id = p_user)
                          else coalesce((
                            select sum(sm.good_or_better_reps)
                            from public.sets st
                            join public.set_metrics sm on sm.set_id = st.id
                            where st.user_id = p_user
                              and st.started_at >= b.starts_at and st.started_at < b.ends_at
                          ), 0) > 0
                        end)
                 from public.challenges b where b.id = p_battle),
    'actorScore', case when p_kind = 'set_submitted' then
        (select jsonb_build_object('validReps', valid_reps, 'metricValue', metric_value)
           from public.challenge_standings_live where challenge_id = p_battle and user_id = p_actor) end,
    'leader', case when p_kind in ('challenge_invite', 'challenge_reminder', 'challenge_reminder_half') then
        (select jsonb_build_object('username', pr.username, 'validReps', l.valid_reps, 'metricValue', l.metric_value)
           from public.challenge_standings_live l left join public.profiles pr on pr.id = l.user_id
          where l.challenge_id = p_battle and l.attempts_used > 0 and l.user_id <> p_user
          order by l.rank limit 1) end,
    'result', case when p_kind = 'challenge_result' then
        (select jsonb_build_object(
                  'rank', me.rank, 'isWinner', me.is_winner, 'validReps', me.valid_reps,
                  'metricValue', me.metric_value,
                  'teamTotal', me.team_total, 'teamTarget', me.team_target,
                  'players', (select count(*) from public.challenge_results c where c.challenge_id = p_battle),
                  'draw', (select count(*) from public.challenge_results c
                            where c.challenge_id = p_battle and c.rank = 1 and c.metric_value is not null) > 1,
                  'top', (select jsonb_agg(jsonb_build_object('username', pr.username, 'rank', c.rank,
                                  'validReps', c.valid_reps, 'metricValue', c.metric_value,
                                  'isWinner', c.is_winner, 'isMe', c.user_id = p_user) order by c.rank, pr.username)
                            from public.challenge_results c left join public.profiles pr on pr.id = c.user_id
                           where c.challenge_id = p_battle and c.rank <= 2))
           from public.challenge_results me where me.challenge_id = p_battle and me.user_id = p_user) end
  ));
$$;

-- A row older than a day, or kept 30 days, is not a successful send.
create function private.expire_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update private.notification_outbox o
     set failed_at = now(),
         leased_until = null
   where o.sent_at is null
     and o.failed_at is null
     and o.created_at <= now() - interval '1 day'
     and (o.not_before is null or o.not_before <= now());
  delete from private.notification_outbox o where o.created_at < now() - interval '30 days';
end $$;

-- Kinds the notify function already in production can turn into text. The migration
-- runs before that function is replaced, and the old function marks whatever this
-- claim returns as sent. Personal nudges stay out of it so that gap cannot drop them.
create function public.claim_notifications(p_limit integer default 200)
returns table (id bigint, user_id uuid, kind text, challenge_id uuid, facts jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.expire_notifications();
  return query
    with picked as (
      select o.id from private.notification_outbox o
       where o.sent_at is null
         and o.failed_at is null
         and o.kind in (
           'friend_request', 'friend_accepted', 'challenge_invite',
           'invite_accepted', 'invite_declined', 'set_submitted', 'challenge_result',
           'challenge_expired', 'challenge_cancelled', 'challenge_reminder', 'challenge_reminder_half'
         )
         and (o.not_before is null or o.not_before <= now())
         and not coalesce(private.in_quiet(o.user_id, now()), false)
       order by o.id
       limit least(greatest(coalesce(p_limit, 200), 1), 1000)
       for update skip locked
    ), done as (
      update private.notification_outbox o set sent_at = now()
        from picked where o.id = picked.id
      returning o.id, o.user_id, o.kind, o.challenge_id, o.actor_id, o.dedupe_key
    )
    select d.id, d.user_id, d.kind, d.challenge_id,
           private.notification_facts(d.kind, d.user_id, d.challenge_id, d.actor_id, d.dedupe_key)
      from done d order by d.id;
end $$;

-- Holds due rows without calling them sent. A crashed drain leases them again
-- after the hold expires. sent_at is a later, separate decision.
create function public.lease_notifications(p_limit integer default 200)
returns table (id bigint, user_id uuid, kind text, challenge_id uuid, facts jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.expire_notifications();
  return query
    with picked as (
      select o.id from private.notification_outbox o
       where o.sent_at is null
         and o.failed_at is null
         and (o.leased_until is null or o.leased_until <= now())
         and (o.not_before is null or o.not_before <= now())
         and not coalesce(private.in_quiet(o.user_id, now()), false)
       order by o.id
       limit least(greatest(coalesce(p_limit, 200), 1), 1000)
       for update skip locked
    ), held as (
      update private.notification_outbox o
         set leased_until = now() + interval '10 minutes'
        from picked
       where o.id = picked.id
      returning o.id, o.user_id, o.kind, o.challenge_id, o.actor_id, o.dedupe_key
    )
    select h.id, h.user_id, h.kind, h.challenge_id,
           private.notification_facts(h.kind, h.user_id, h.challenge_id, h.actor_id, h.dedupe_key)
      from held h order by h.id;
end $$;

-- p_sent: Expo was called with real text. p_failed: a known kind had nothing to send.
create function public.settle_notifications(p_sent bigint[], p_failed bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update private.notification_outbox o
     set sent_at = now(),
         leased_until = null
   where o.id = any(coalesce(p_sent, '{}'::bigint[]))
     and o.sent_at is null
     and o.failed_at is null;
  update private.notification_outbox o
     set failed_at = now(),
         leased_until = null
   where o.id = any(coalesce(p_failed, '{}'::bigint[]))
     and o.sent_at is null
     and o.failed_at is null
     and not (o.id = any(coalesce(p_sent, '{}'::bigint[])));
end $$;

-- Unknown kinds and attempts that never reached Expo stay queued.
create function public.release_notifications(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update private.notification_outbox o
     set leased_until = null
   where o.id = any(coalesce(p_ids, '{}'::bigint[]))
     and o.sent_at is null
     and o.failed_at is null;
end $$;

revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;
revoke all on function public.lease_notifications(integer) from public, anon, authenticated;
grant execute on function public.lease_notifications(integer) to service_role;
revoke all on function public.settle_notifications(bigint[], bigint[]) from public, anon, authenticated;
grant execute on function public.settle_notifications(bigint[], bigint[]) to service_role;
revoke all on function public.release_notifications(bigint[]) from public, anon, authenticated;
grant execute on function public.release_notifications(bigint[]) to service_role;

revoke all on function
  private.nudge_pref(uuid),
  private.time_in_quiet(time, time, time),
  private.in_quiet(uuid, timestamptz),
  private.league_board(uuid, timestamptz),
  private.lead_set(uuid, timestamptz, integer, integer),
  private.queue_personal_nudges(),
  private.tg_notify_window_set(),
  private.tg_notification_prefs_touch(),
  private.tg_profile_notification_prefs(),
  private.expire_notifications(),
  private.daily_nudge_facts(uuid),
  private.pass_facts(uuid, uuid, text),
  private.recap_facts(uuid, text),
  private.notification_facts(text, uuid, uuid, uuid, text)
  from public, anon, authenticated;
