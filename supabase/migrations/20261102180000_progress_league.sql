-- Slice 4: the weekly friends league. Nothing is stored. my_league reads sets, goals, and
-- accepted friendships at call time. It is security definer because a friend's sets are not
-- visible under row level security; the friend filter below is the privacy boundary.
-- It returns aggregates only. It does not return set ids, and it does not widen set policies.
-- Old builds never call this function. friends_visibility changes to a value they ignore,
-- so they keep their built-in battle_results_only restriction.

insert into public.app_settings (key, value, description) values
  ('upload_grace_s', '900',
   'A set counts in the league only when the server received it by the end of its recorded week, plus this many seconds. A later upload still stays in personal history.'),
  ('league_improvement_weights',
   '{"per_rep_above_usual": 1, "per_goal_day": 20, "perfect_week": 30, "baseline_weeks": 8, "baseline_min_weeks": 3}',
   'Improvement points. Beat is reps above the usual week. Goal days and a finished perfect week add flat points. No term goes below zero.')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

update public.app_settings
   set value = '"league_and_challenge_results"',
       description = 'Documents what my_league and challenge results return: totals for accepted friends, not raw sets. Set policies do not get wider. An older app ignores every value except battle_results_only and keeps that restriction.'
 where key = 'friends_visibility';

create or replace function public.my_league()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_weights  jsonb;
  v_grace    integer;
  v_per_rep  numeric;
  v_per_goal integer;
  v_perfect  integer;
  v_base     integer;
  v_min      integer;
  v_span     integer;
  v_zone     text;
  v_week     date;
  v_people   integer;
  v_doc      jsonb;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'pick a username first'; end if;

  v_weights := coalesce(public.setting('league_improvement_weights'),
    '{"per_rep_above_usual":1,"per_goal_day":20,"perfect_week":30,"baseline_weeks":8,"baseline_min_weeks":3}'::jsonb);
  v_grace := least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400);
  v_per_rep := greatest(coalesce((v_weights->>'per_rep_above_usual')::numeric, 1), 0);
  v_per_goal := least(greatest(coalesce((v_weights->>'per_goal_day')::integer, 20), 0), 100000);
  v_perfect := least(greatest(coalesce((v_weights->>'perfect_week')::integer, 30), 0), 100000);
  v_base := least(greatest(coalesce((v_weights->>'baseline_weeks')::integer, 8), 1), 52);
  v_min := least(greatest(coalesce((v_weights->>'baseline_min_weeks')::integer, 3), 1), v_base);
  v_span := (v_base + 1) * 7;

  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = v_user;
  v_week := ((now() at time zone v_zone)::date - (extract(isodow from (now() at time zone v_zone)::date)::int - 1));

  -- Headcount is fixed before the board is built, so a two-person tie can share a crown.
  select count(*) into v_people from (
    select p.id
    from public.profiles p
    where p.id = v_user
       or exists (
         select 1 from public.friendships f
         where f.status = 'accepted'
           and least(f.user_low, f.user_high) = least(v_user, p.id)
           and greatest(f.user_low, f.user_high) = greatest(v_user, p.id)
       )
  ) people;

  with members as (
    select p.id, p.username, p.display_name,
           coalesce(nullif(btrim(p.time_zone), ''), 'UTC') as zone
    from public.profiles p
    where p.id = v_user
       or exists (
         select 1 from public.friendships f
         where f.status = 'accepted'
           and least(f.user_low, f.user_high) = least(v_user, p.id)
           and greatest(f.user_low, f.user_high) = greatest(v_user, p.id)
       )
  ),
  clock as (
    select m.*,
           (now() at time zone m.zone)::date as today,
           ((now() at time zone m.zone)::date
             - (extract(isodow from (now() at time zone m.zone)::date)::int - 1))::date as week_start
    from members m
  ),
  eligible as (
    select s.user_id,
           s.recorded_time_zone,
           (s.started_at at time zone s.recorded_time_zone)::date as local_date,
           m.good_or_better_reps as reps,
           s.received_at
    from public.sets s
    join public.set_metrics m on m.set_id = s.id
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
    select user_id,
           (min(local_date) - (extract(isodow from min(local_date))::int - 1))::date as first_week
    from days
    group by user_id
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
    select id as user_id, week_start as ref_week, true as is_current from clock
    union all
    select id, (week_start - 7)::date, false from clock
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
    select user_id, ref_week,
           count(*)::int as weeks,
           case when count(*) >= v_min then percentile_cont(0.5) within group (order by reps) end as usual
    from samples
    where n <= v_base
    group by user_id, ref_week
  ),
  day_rows as (
    select c.id as user_id,
           gs.day::date as local_date,
           (gs.day::date - (extract(isodow from gs.day::date)::int - 1))::date as bucket,
           c.today,
           coalesce(d.reps, 0)::int as reps,
           case
             when enr.custom_daily_reps is not null then enr.custom_daily_reps
             when seg.daily_target is null then null
             when seg.rest_weekday is not null and extract(isodow from gs.day::date)::int = seg.rest_weekday then 0
             else seg.daily_target
           end as target
    from clock c
    join lateral generate_series(
      (c.week_start - 7)::timestamp,
      (c.week_start + 6)::timestamp,
      interval '1 day'
    ) as gs(day) on true
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
      select s.daily_target, s.rest_weekday
      from public.program_segments s
      join public.programs pr on pr.id = s.program_id
      where enr.program_id is not null
        and s.program_id = enr.program_id
        and (
          ((gs.day::date - enr.started_on) + 1) between s.day_from and s.day_to
          or (
            pr.maintains_after
            and ((gs.day::date - enr.started_on) + 1) > (
              select max(day_to) from public.program_segments where program_id = enr.program_id
            )
            and s.day_to = (select max(day_to) from public.program_segments where program_id = enr.program_id)
          )
        )
      order by s.segment_index
      limit 1
    ) seg on true
  ),
  week_goals as (
    select user_id, bucket,
           count(*) filter (where target > 0)::int as scheduled,
           count(*) filter (where target > 0 and local_date <= today and reps >= target)::int as hit
    from day_rows
    group by user_id, bucket
  ),
  scores as (
    select r.user_id, r.ref_week, r.is_current,
           coalesce(wr.reps, 0)::int as reps,
           coalesce(g.scheduled, 0)::int as scheduled,
           coalesce(g.hit, 0)::int as hit,
           coalesce(u.weeks, 0)::int as baseline_weeks,
           u.usual,
           case when u.usual is null then 0
                else floor(greatest(0, coalesce(wr.reps, 0) - u.usual) * v_per_rep)::int
           end as beat,
           (coalesce(g.hit, 0) * v_per_goal)::int as goal_points,
           case
             when c.today >= r.ref_week + 7
              and coalesce(g.scheduled, 0) > 0
              and coalesce(g.hit, 0) = g.scheduled
             then v_perfect else 0
           end as perfect
    from refs r
    join clock c on c.id = r.user_id
    left join week_reps wr on wr.user_id = r.user_id and wr.week_start = r.ref_week
    left join week_goals g on g.user_id = r.user_id and g.bucket = r.ref_week
    left join usual_for u on u.user_id = r.user_id and u.ref_week = r.ref_week
  ),
  current_ranked as (
    select s.*,
           rank() over (order by s.reps desc)::int as total_rank,
           rank() over (order by (s.beat + s.goal_points + s.perfect) desc, s.hit desc, s.reps desc)::int as imp_rank
    from scores s
    where s.is_current
  ),
  prev_ranked as (
    select s.*,
           rank() over (order by s.reps desc)::int as total_rank,
           rank() over (order by (s.beat + s.goal_points + s.perfect) desc, s.hit desc, s.reps desc)::int as imp_rank
    from scores s
    where not s.is_current
  ),
  board_rows as (
    select c.id, c.username::text as username, c.display_name,
           cr.reps, cr.hit, cr.scheduled, cr.baseline_weeks, cr.usual,
           (cr.beat + cr.goal_points + cr.perfect)::int as points,
           cr.total_rank, cr.imp_rank,
           (v_people >= 2 and pr.total_rank = 1) as total_crown,
           (v_people >= 2 and pr.imp_rank = 1) as imp_crown
    from clock c
    join current_ranked cr on cr.user_id = c.id
    join prev_ranked pr on pr.user_id = c.id
  )
  select jsonb_build_object(
    'weekStart', v_week,
    'weekEnd', (v_week + 7),
    'timeZone', v_zone,
    'total', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', id,
        'username', username,
        'displayName', display_name,
        'reps', reps,
        'rank', total_rank,
        'crownedLastWeek', total_crown
      ) order by total_rank, username)
      from board_rows
    ), '[]'::jsonb),
    'improvement', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', id,
        'username', username,
        'displayName', display_name,
        'points', points,
        'reps', reps,
        'goalDaysHit', hit,
        'goalDaysScheduled', scheduled,
        'usual', usual,
        'baselineWeeks', baseline_weeks,
        'baselineMinWeeks', v_min,
        'rank', imp_rank,
        'crownedLastWeek', imp_crown
      ) order by imp_rank, username)
      from board_rows
    ), '[]'::jsonb)
  ) into v_doc;

  return v_doc;
end $$;

revoke all on function public.my_league() from public, anon, authenticated;
grant execute on function public.my_league() to authenticated;
