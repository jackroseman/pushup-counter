-- Slice 3: a signed-in person's zone, goal, and progress follow them to another phone.
-- Totals are calculated here, not stored. Old submit_set payloads omit the zone;
-- the insert trigger fills it from the profile so those builds keep uploading.
-- Battle views stay. user_stats goes away; the app never read it.

-- -------------------------------------------------------------------------------------
-- The zone a set was recorded in. A fact about the workout, not a score.
-- -------------------------------------------------------------------------------------
alter table public.sets add column recorded_time_zone text;

update public.sets s
   set recorded_time_zone = coalesce(nullif(btrim(p.time_zone), ''), 'UTC')
  from public.profiles p
 where p.id = s.user_id
   and s.recorded_time_zone is null;

update public.sets set recorded_time_zone = 'UTC' where recorded_time_zone is null;

create or replace function public.tg_sets_fill_time_zone()
returns trigger language plpgsql as $$
declare
  z text;
begin
  if new.recorded_time_zone is null or btrim(new.recorded_time_zone) = '' then
    select time_zone into z from public.profiles where id = new.user_id;
    new.recorded_time_zone := coalesce(nullif(btrim(z), ''), 'UTC');
  else
    new.recorded_time_zone := btrim(new.recorded_time_zone);
  end if;
  begin
    perform now() at time zone new.recorded_time_zone;
  exception when invalid_parameter_value then
    raise exception 'unknown time zone';
  end;
  return new;
end $$;

create trigger sets_fill_time_zone
  before insert on public.sets
  for each row execute function public.tg_sets_fill_time_zone();

alter table public.sets alter column recorded_time_zone set not null;

-- Same function as claim-finished-set, plus the optional zone. Omitted means the trigger
-- copies profiles.time_zone, which is what an older build sends.
create or replace function public.submit_set(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_user   uuid := case when current_user = 'service_role' then (p->>'userId')::uuid
                        else (select auth.uid()) end;
  v_start  timestamptz := to_timestamp((p->>'startedAt')::double precision / 1000);
  v_battle uuid := (p->>'battleId')::uuid;
  v_link   boolean := coalesce((p->>'linkFinishedSet')::boolean, false);
  v_set    uuid;
  existing public.sets;
  attempt  integer;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if v_battle is not null and current_user <> 'service_role' then
    raise exception 'battle sets go through submit-set';
  end if;

  for attempt in 1..2 loop
    select * into existing from public.sets where user_id = v_user and client_set_id = p->>'id';
    if found then
      if v_battle is null or existing.battle_id is not distinct from v_battle then
        return existing.id;
      end if;
      if existing.battle_id is not null then raise exception 'set already in a battle'; end if;
      if not v_link then raise exception 'set already uploaded and was not linked'; end if;
      update public.sets
         set battle_id = v_battle
       where id = existing.id and user_id = v_user and battle_id is null
       returning id into v_set;
      if v_set is null then raise exception 'set already in a battle'; end if;
      return v_set;
    end if;

    if v_battle is not null and v_link then
      perform private.assert_finished_set_claim(
        to_timestamp((p->>'endedAt')::double precision / 1000),
        (p->>'timerDurationS')::integer,
        coalesce((p->>'version')::smallint, 1),
        p ? 'detectorConfig',
        v_battle);
    end if;

    begin
      insert into public.sets (user_id, client_set_id, battle_id, device_id, detector_config_id,
          data_version, app_version, update_id, started_at, ended_at, calibrated_top_m,
          calibration_samples, depth_tracking, proximity_available, clock_offset_ms, timer_duration_s,
          recorded_time_zone)
      values (v_user, p->>'id', v_battle, (p->>'deviceId')::uuid,
          case when p ? 'detectorConfig' then public.ensure_detector_config(p->'detectorConfig') end,
          coalesce((p->>'version')::smallint, 1), p->>'appVersion', p->>'updateId',
          v_start, to_timestamp((p->>'endedAt')::double precision / 1000),
          (p->>'calibratedTopDistance')::real, (p->>'calibrationSamples')::smallint,
          coalesce((p->>'depthTracking')::boolean, true), (p->>'proximityAvailable')::boolean,
          (p->>'clockOffsetMs')::integer,
          (p->>'timerDurationS')::integer,
          nullif(btrim(p->>'timeZone'), ''))
      returning id into v_set;

      insert into public.reps (set_id, rep_index, started_ms, bottom_ms, completed_ms,
          bottom_distance_m, top_distance_m, face_lost_at_bottom, proximity_touched, source, legacy_quality)
      select v_set, r."index",
             round(r."startedAt" - (p->>'startedAt')::double precision)::integer,
             round(r."bottomAt"  - (p->>'startedAt')::double precision)::integer,
             round(r."timestamp" - (p->>'startedAt')::double precision)::integer,
             r."bottomDistance", r."topDistance", coalesce(r."faceLostAtBottom", false),
             r."proximityTouched", coalesce(r.source, 'depth'),
             case when coalesce((p->>'version')::int, 1) < 2 then r.quality end
      from jsonb_to_recordset(coalesce(p->'reps', '[]'::jsonb)) as r(
             "index" smallint, "startedAt" double precision, "bottomAt" double precision,
             "timestamp" double precision, "bottomDistance" real, "topDistance" real,
             "faceLostAtBottom" boolean, "proximityTouched" boolean,
             source public.rep_source, quality public.rep_quality);

      if jsonb_typeof(p->'trace') = 'array' and jsonb_array_length(p->'trace') > 0 then
        insert into public.set_traces (set_id, resolution_ms, t_ms, distance_m)
        select v_set, coalesce((p->>'traceResolutionMs')::integer, 100),
               array_agg((e->>0)::integer order by o), array_agg((e->>1)::real order by o)
        from jsonb_array_elements(p->'trace') with ordinality as t(e, o);
      end if;
      return v_set;
    exception when unique_violation then
      if attempt = 2 then raise; end if;
    end;
  end loop;
  raise exception 'could not save set';
end $$;

-- -------------------------------------------------------------------------------------
-- Programs. Targets are never edited in place. A different ramp is a new id.
-- -------------------------------------------------------------------------------------
create table public.programs (
  id                   text primary key,
  name                 text not null,
  summary              text not null,
  completion_rule      text not null check (completion_rule in ('single_set', 'finish_schedule')),
  completion_set_reps  integer,
  maintains_after      boolean not null,
  sort_order           smallint not null,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  check (completion_rule <> 'single_set' or completion_set_reps is not null)
);

create table public.program_segments (
  program_id    text not null references public.programs (id),
  segment_index smallint not null,
  day_from      smallint not null,
  day_to        smallint not null,
  daily_target  integer not null check (daily_target >= 0),
  rest_weekday  smallint check (rest_weekday between 1 and 7),
  set_marker    integer,
  primary key (program_id, segment_index),
  check (day_to >= day_from and day_from >= 1)
);

insert into public.programs (id, name, summary, completion_rule, completion_set_reps, maintains_after, sort_order) values
  ('first_20', 'First 20 in a row', 'Build to 20 good reps in one set. Sundays off.', 'single_set', 20, true, 1),
  ('fifty_a_day', '50 a day', 'Work up to 50 push-ups a day.', 'finish_schedule', null, true, 2),
  ('hundred_in_30', '100 a day in 30 days', 'Reach 100 push-ups a day in 30 days.', 'finish_schedule', null, true, 3);

insert into public.program_segments (program_id, segment_index, day_from, day_to, daily_target, rest_weekday, set_marker) values
  ('first_20', 1, 1, 7, 10, 7, 5),
  ('first_20', 2, 8, 14, 15, 7, 10),
  ('first_20', 3, 15, 21, 20, 7, 15),
  ('first_20', 4, 22, 28, 25, 7, 20),
  ('fifty_a_day', 1, 1, 7, 20, null, null),
  ('fifty_a_day', 2, 8, 14, 30, null, null),
  ('fifty_a_day', 3, 15, 21, 40, null, null),
  ('fifty_a_day', 4, 22, 28, 50, null, null),
  ('hundred_in_30', 1, 1, 7, 40, null, null),
  ('hundred_in_30', 2, 8, 14, 55, null, null),
  ('hundred_in_30', 3, 15, 21, 70, null, null),
  ('hundred_in_30', 4, 22, 30, 100, null, null);

-- -------------------------------------------------------------------------------------
-- One open goal per person. Switching today rewrites today's row. A later day closes it.
-- -------------------------------------------------------------------------------------
create table public.goal_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  program_id          text references public.programs (id),
  custom_daily_reps   integer check (custom_daily_reps between 1 and 2000),
  started_on          date not null,
  ended_on            date,
  recorded_time_zone  text not null,
  created_at          timestamptz not null default now(),
  check ((program_id is not null) <> (custom_daily_reps is not null)),
  check (ended_on is null or ended_on > started_on)
);

create unique index goal_enrollments_one_open on public.goal_enrollments (user_id) where ended_on is null;
create index goal_enrollments_user_started on public.goal_enrollments (user_id, started_on desc);

insert into public.app_settings (key, value, description) values
  ('personal_backfill_days', '60',
   'Streaks ignore a set whose server receipt is more than this many days after it started. Records and lifetime still count it.'),
  ('usual_weekday', '{"lookback_weeks": 8, "min_samples": 3}',
   'The Today line compares today with this many earlier same-weekdays, and hides below min_samples.'),
  ('custom_goal_reps', '{"min": 5, "max": 500, "step": 5, "suggested": 30}',
   'Bounds for a custom daily goal. The table allows 1 to 2000 so these can move without a migration.');

-- -------------------------------------------------------------------------------------
-- Read models. security invoker, so the set policy is the privacy boundary.
-- -------------------------------------------------------------------------------------
create view public.daily_totals with (security_invoker = true) as
select s.user_id,
       (s.started_at at time zone s.recorded_time_zone)::date as local_date,
       sum(m.good_or_better_reps)::integer as counted_reps,
       count(*)::integer as set_count
from public.sets s
join public.set_metrics m on m.set_id = s.id
group by 1, 2;

create view public.weekly_totals with (security_invoker = true) as
select user_id,
       (local_date - (extract(isodow from local_date)::integer - 1))::date as week_start,
       sum(counted_reps)::integer as counted_reps
from public.daily_totals
group by 1, 2;

create view public.monthly_totals with (security_invoker = true) as
select user_id,
       date_trunc('month', local_date)::date as month_start,
       sum(counted_reps)::integer as counted_reps
from public.daily_totals
group by 1, 2;

-- One row per date a goal covered. The latest enrollment wins if ranges ever overlap.
create view public.goal_for_date with (security_invoker = true) as
select distinct on (e.user_id, d::date)
       e.user_id,
       d::date as local_date,
       case
         when e.custom_daily_reps is not null then e.custom_daily_reps
         when seg.rest_weekday is not null and extract(isodow from d)::integer = seg.rest_weekday then 0
         else seg.daily_target
       end as target_reps,
       (e.custom_daily_reps is null and seg.rest_weekday is not null and extract(isodow from d)::integer = seg.rest_weekday) as rest,
       e.program_id,
       e.id as enrollment_id
from public.goal_enrollments e
join public.profiles p on p.id = e.user_id
join lateral generate_series(
       e.started_on::timestamp,
       coalesce((e.ended_on - 1), (now() at time zone p.time_zone)::date)::timestamp,
       interval '1 day') as d on true
left join lateral (
  select s.daily_target, s.rest_weekday
  from public.program_segments s
  join public.programs pr on pr.id = s.program_id
  where s.program_id = e.program_id
    and (
      ((d::date - e.started_on) + 1) between s.day_from and s.day_to
      or (
        pr.maintains_after
        and ((d::date - e.started_on) + 1) > (select max(day_to) from public.program_segments where program_id = e.program_id)
        and s.day_to = (select max(day_to) from public.program_segments where program_id = e.program_id)
      )
    )
  order by s.segment_index
  limit 1
) seg on true
where e.custom_daily_reps is not null or seg.daily_target is not null
order by e.user_id, d::date, e.started_on desc;

-- -------------------------------------------------------------------------------------
-- enroll_goal writes. There is no insert policy, so this is the only door.
-- security definer, pinned to the caller, search_path fixed.
-- -------------------------------------------------------------------------------------
create or replace function public.enroll_goal(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_zone    text;
  v_today   date;
  v_program text := nullif(btrim(p->>'programId'), '');
  v_custom  integer := (p->>'customDailyReps')::integer;
  v_bounds  jsonb;
  v_open    public.goal_enrollments;
  v_id      uuid;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'pick a username first'; end if;
  if (v_program is null) = (v_custom is null) then raise exception 'pick a program or a daily number'; end if;
  if p ? 'programId' and p ? 'customDailyReps' and v_program is not null and v_custom is not null then
    raise exception 'pick a program or a daily number';
  end if;

  if v_program is not null then
    if not exists (select 1 from public.programs where id = v_program and active) then
      raise exception 'unknown program';
    end if;
    v_custom := null;
  else
    v_bounds := coalesce(public.setting('custom_goal_reps'), '{"min":5,"max":500}'::jsonb);
    if v_custom < (v_bounds->>'min')::integer or v_custom > (v_bounds->>'max')::integer then
      raise exception 'choose a number from % to %', v_bounds->>'min', v_bounds->>'max';
    end if;
  end if;

  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = v_user;
  v_today := (now() at time zone v_zone)::date;

  select * into v_open from public.goal_enrollments where user_id = v_user and ended_on is null;
  if found and v_open.started_on = v_today then
    update public.goal_enrollments
       set program_id = v_program,
           custom_daily_reps = v_custom,
           recorded_time_zone = v_zone
     where id = v_open.id
     returning id into v_id;
  else
    if found then
      update public.goal_enrollments set ended_on = v_today where id = v_open.id;
    end if;
    insert into public.goal_enrollments (user_id, program_id, custom_daily_reps, started_on, recorded_time_zone)
    values (v_user, v_program, v_custom, v_today, v_zone)
    returning id into v_id;
  end if;

  return (
    select jsonb_build_object(
      'id', id,
      'programId', program_id,
      'customDailyReps', custom_daily_reps,
      'startedOn', started_on,
      'endedOn', ended_on,
      'recordedTimeZone', recorded_time_zone,
      'createdAt', created_at
    )
    from public.goal_enrollments where id = v_id
  );
end $$;

-- -------------------------------------------------------------------------------------
-- my_progress: the caller's ring, streak, records, badges, and charts. Nothing is stored.
-- -------------------------------------------------------------------------------------
create or replace function public.my_progress()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_zone     text;
  v_today    date;
  v_backfill integer;
  v_lookback integer;
  v_min_samples integer;
  v_all      jsonb;
  v_streak   jsonb;
  v_goals    jsonb;
  v_anchor   date;
  v_first_set date;
  v_first_goal date;
  v_samples  integer[];
  v_i        integer;
  v_sample_day date;
  v_usual    numeric;
  v_today_reps integer;
  v_target   integer;
  v_rest     boolean;
  v_goal_met boolean;
  v_delta    numeric;
  v_start    date;
  v_date     date;
  v_run      integer;
  v_longest  integer;
  v_current  integer;
  v_met      boolean;
  v_day_rest boolean;
  v_day_target integer;
  v_has_goal boolean;
  v_lifetime integer;
  v_before   integer;
  v_earned   jsonb := '{}'::jsonb;
  rec        record;
  v_open     public.goal_enrollments;
  v_program  public.programs;
  v_seg      public.program_segments;
  v_day_n    integer;
  v_maintaining boolean;
  v_complete boolean;
  v_status   text;
  v_name     text;
  v_detail   text;
  v_week     date;
  v_month    date;
  v_cursor   date;
  v_end_week date;
  v_points   jsonb;
  v_acc      integer;
  v_best_set jsonb;
  v_best_day jsonb;
  v_best_week jsonb;
  v_best_month jsonb;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'pick a username first'; end if;

  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone from public.profiles where id = v_user;
  v_today := (now() at time zone v_zone)::date;
  v_backfill := coalesce((public.setting('personal_backfill_days'))::text::integer, 60);
  v_lookback := coalesce((public.setting('usual_weekday')->>'lookback_weeks')::integer, 8);
  v_min_samples := coalesce((public.setting('usual_weekday')->>'min_samples')::integer, 3);

  select coalesce(jsonb_object_agg(local_date::text, counted_reps), '{}'::jsonb)
    into v_all
  from (
    select (s.started_at at time zone s.recorded_time_zone)::date as local_date,
           sum(m.good_or_better_reps)::integer as counted_reps
    from public.sets s
    join public.set_metrics m on m.set_id = s.id
    where s.user_id = v_user
    group by 1
  ) days;

  select coalesce(jsonb_object_agg(local_date::text, counted_reps), '{}'::jsonb)
    into v_streak
  from (
    select (s.started_at at time zone s.recorded_time_zone)::date as local_date,
           sum(m.good_or_better_reps)::integer as counted_reps
    from public.sets s
    join public.set_metrics m on m.set_id = s.id
    where s.user_id = v_user
      and s.started_at <= s.received_at + interval '2 minutes'
      and s.received_at <= s.started_at + make_interval(days => v_backfill)
    group by 1
  ) days;

  select coalesce(jsonb_object_agg(local_date::text, jsonb_build_object('target', target_reps, 'rest', rest)), '{}'::jsonb)
    into v_goals
  from public.goal_for_date
  where user_id = v_user;

  v_today_reps := coalesce((v_all->>v_today::text)::integer, 0);
  v_has_goal := v_goals ? v_today::text;
  v_target := case when v_has_goal then (v_goals->v_today::text->>'target')::integer else null end;
  v_rest := coalesce((v_goals->v_today::text->>'rest')::boolean, false);
  v_goal_met := v_target is not null and v_target > 0 and v_today_reps >= v_target;

  select min((s.started_at at time zone s.recorded_time_zone)::date) into v_first_set
  from public.sets s where s.user_id = v_user;
  select min(started_on) into v_first_goal from public.goal_enrollments where user_id = v_user;
  v_anchor := case
    when v_first_set is null then v_first_goal
    when v_first_goal is null then v_first_set
    else least(v_first_set, v_first_goal)
  end;

  v_samples := array[]::integer[];
  if v_anchor is not null then
    for v_i in 1..v_lookback loop
      v_sample_day := v_today - (7 * v_i);
      if v_sample_day >= v_anchor then
        v_samples := v_samples || coalesce((v_all->>v_sample_day::text)::integer, 0);
      end if;
    end loop;
  end if;
  if cardinality(v_samples) >= v_min_samples then
    select percentile_cont(0.5) within group (order by sample) into v_usual from unnest(v_samples) as sample;
    v_delta := v_today_reps - v_usual;
  else
    v_usual := null;
    v_delta := null;
  end if;

  v_current := 0;
  v_longest := 0;
  v_start := v_first_goal;
  if v_start is not null and v_today >= v_start then
    v_run := 0;
    v_date := v_start;
    while v_date <= v_today loop
      v_has_goal := v_goals ? v_date::text;
      v_day_rest := coalesce((v_goals->v_date::text->>'rest')::boolean, false);
      v_day_target := coalesce((v_goals->v_date::text->>'target')::integer, 0);
      v_met := v_has_goal and not v_day_rest and v_day_target > 0
        and coalesce((v_streak->>v_date::text)::integer, 0) >= v_day_target;
      if not v_has_goal then
        v_run := 0;
      elsif v_day_rest then
        null;
      elsif v_met then
        v_run := v_run + 1;
        v_longest := greatest(v_longest, v_run);
      elsif v_date = v_today then
        null;
      else
        v_run := 0;
      end if;
      v_date := v_date + 1;
    end loop;

    v_date := v_today;
    while v_date >= v_start loop
      v_has_goal := v_goals ? v_date::text;
      exit when not v_has_goal;
      v_day_rest := coalesce((v_goals->v_date::text->>'rest')::boolean, false);
      v_day_target := coalesce((v_goals->v_date::text->>'target')::integer, 0);
      v_met := not v_day_rest and v_day_target > 0 and coalesce((v_streak->>v_date::text)::integer, 0) >= v_day_target;
      if v_date = v_today and not v_day_rest and not v_met then
        v_date := v_date - 1;
        continue;
      end if;
      if v_day_rest then
        v_date := v_date - 1;
        continue;
      end if;
      exit when not v_met;
      v_current := v_current + 1;
      v_date := v_date - 1;
    end loop;
  end if;

  v_lifetime := 0;
  for rec in
    select m.good_or_better_reps as counted,
           (s.started_at at time zone s.recorded_time_zone)::date as local_date
    from public.sets s
    join public.set_metrics m on m.set_id = s.id
    where s.user_id = v_user
    order by s.started_at, s.client_set_id
  loop
    v_before := v_lifetime;
    v_lifetime := v_lifetime + rec.counted;
    if v_before < 1000 and v_lifetime >= 1000 and not (v_earned ? '1000') then
      v_earned := v_earned || jsonb_build_object('1000', rec.local_date);
    end if;
    if v_before < 10000 and v_lifetime >= 10000 and not (v_earned ? '10000') then
      v_earned := v_earned || jsonb_build_object('10000', rec.local_date);
    end if;
    if v_before < 100000 and v_lifetime >= 100000 and not (v_earned ? '100000') then
      v_earned := v_earned || jsonb_build_object('100000', rec.local_date);
    end if;
  end loop;

  select jsonb_build_object('reps', m.good_or_better_reps, 'date', (s.started_at at time zone s.recorded_time_zone)::date)
    into v_best_set
  from public.sets s
  join public.set_metrics m on m.set_id = s.id
  where s.user_id = v_user and m.good_or_better_reps > 0
  order by m.good_or_better_reps desc, (s.started_at at time zone s.recorded_time_zone)::date, s.started_at
  limit 1;

  select jsonb_build_object('reps', counted_reps, 'date', local_date) into v_best_day
  from public.daily_totals where user_id = v_user and counted_reps > 0
  order by counted_reps desc, local_date limit 1;

  select jsonb_build_object('reps', counted_reps, 'date', week_start) into v_best_week
  from public.weekly_totals where user_id = v_user and counted_reps > 0
  order by counted_reps desc, week_start limit 1;

  select jsonb_build_object('reps', counted_reps, 'date', month_start) into v_best_month
  from public.monthly_totals where user_id = v_user and counted_reps > 0
  order by counted_reps desc, month_start limit 1;

  select * into v_open from public.goal_enrollments where user_id = v_user and ended_on is null;
  if not found then
    v_status := 'not_started';
    v_name := 'Program';
    v_detail := 'Not started';
  elsif v_open.program_id is null then
    v_status := 'in_progress';
    v_name := 'Custom goal';
    v_detail := v_open.custom_daily_reps::text || ' a day';
  else
    select * into v_program from public.programs where id = v_open.program_id;
    v_complete := false;
    if v_program.completion_rule = 'single_set' then
      select exists (
        select 1
        from public.sets s
        join public.set_metrics m on m.set_id = s.id
        where s.user_id = v_user
          and (s.started_at at time zone s.recorded_time_zone)::date >= v_open.started_on
          and (v_open.ended_on is null or (s.started_at at time zone s.recorded_time_zone)::date < v_open.ended_on)
          and m.good_or_better_reps >= v_program.completion_set_reps
      ) into v_complete;
    else
      v_day_n := (select max(day_to) from public.program_segments where program_id = v_program.id);
      v_complete := v_today > (v_open.started_on + (v_day_n - 1))
        and (v_open.ended_on is null or (v_open.started_on + (v_day_n - 1)) < v_open.ended_on);
    end if;
    if v_complete then
      v_status := 'complete';
      v_name := v_program.name;
      v_detail := 'Complete';
    else
      v_day_n := greatest(1, (v_today - v_open.started_on) + 1);
      select * into v_seg from public.program_segments
       where program_id = v_program.id and v_day_n between day_from and day_to;
      v_maintaining := false;
      if not found and v_program.maintains_after then
        select * into v_seg from public.program_segments
         where program_id = v_program.id
         order by day_to desc limit 1;
        v_maintaining := true;
      end if;
      v_status := 'in_progress';
      v_name := v_program.name;
      if v_seg.program_id is null then
        v_detail := v_program.name;
      else
        v_detail := case when v_maintaining then 'Maintaining' else 'Week ' || v_seg.segment_index::text end
          || ' · ' || v_seg.daily_target::text || ' a day'
          || case when v_seg.rest_weekday = 7 then ' · Sunday off' else '' end;
      end if;
    end if;
  end if;

  v_week := (v_today - (extract(isodow from v_today)::integer - 1))::date;
  v_month := date_trunc('month', v_today)::date;

  if v_first_set is null then
    v_points := '[]'::jsonb;
  else
    v_end_week := (greatest(v_today, (select max(local_date::date) from jsonb_object_keys(v_all) as local_date))
      - (extract(isodow from greatest(v_today, (select max(local_date::date) from jsonb_object_keys(v_all) as local_date)))::integer - 1))::date;
    v_cursor := (v_first_set - (extract(isodow from v_first_set)::integer - 1))::date;
    v_points := '[]'::jsonb;
    v_acc := 0;
    while v_cursor <= v_end_week loop
      select coalesce(sum(value::integer), 0) into v_run
      from jsonb_each_text(v_all) as t(key, value)
      where key::date between v_cursor and v_cursor + 6;
      v_acc := v_acc + v_run;
      v_points := v_points || jsonb_build_array(jsonb_build_object('weekStart', v_cursor, 'total', v_acc));
      v_cursor := v_cursor + 7;
    end loop;
  end if;

  return jsonb_build_object(
    'timeZone', v_zone,
    'today', v_today,
    'todayReps', v_today_reps,
    'target', v_target,
    'rest', v_rest,
    'goalMet', v_goal_met,
    'usual', v_usual,
    'delta', v_delta,
    'currentStreak', v_current,
    'longestStreak', v_longest,
    'lifetimeReps', v_lifetime,
    'badges', jsonb_build_array(
      jsonb_build_object('milestone', 1000, 'earnedOn', v_earned->'1000', 'remaining', case when v_earned ? '1000' then null else 1000 - v_lifetime end),
      jsonb_build_object('milestone', 10000, 'earnedOn', v_earned->'10000', 'remaining', case when v_earned ? '10000' then null else 10000 - v_lifetime end),
      jsonb_build_object('milestone', 100000, 'earnedOn', v_earned->'100000', 'remaining', case when v_earned ? '100000' then null else 100000 - v_lifetime end)
    ),
    'records', jsonb_build_object(
      'bestSet', v_best_set,
      'bestDay', v_best_day,
      'bestWeek', v_best_week,
      'bestMonth', v_best_month
    ),
    'charts', jsonb_build_object(
      'day', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', d::date,
          'reps', coalesce((v_all->>d::date::text)::integer, 0),
          'target', case when v_goals ? d::date::text then (v_goals->d::date::text->>'target')::integer else null end
        ) order by d), '[]'::jsonb)
        from generate_series((v_today - 13)::timestamp, v_today::timestamp, interval '1 day') d
      ),
      'week', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'start', w::date,
          'reps', coalesce((
            select sum(value::integer) from jsonb_each_text(v_all) as t(key, value)
            where key::date between w::date and w::date + 6
          ), 0)
        ) order by w), '[]'::jsonb)
        from generate_series((v_week - 77)::timestamp, v_week::timestamp, interval '7 days') w
      ),
      'month', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'start', date_trunc('month', m)::date,
          'reps', coalesce((
            select sum(value::integer) from jsonb_each_text(v_all) as t(key, value)
            where key::date >= date_trunc('month', m)::date
              and key::date < (date_trunc('month', m) + interval '1 month')::date
          ), 0)
        ) order by m), '[]'::jsonb)
        from generate_series((v_month - interval '11 months')::timestamp, v_month::timestamp, interval '1 month') m
      ),
      'lifetime', v_points
    ),
    'program', jsonb_build_object('status', v_status, 'name', v_name, 'detail', v_detail),
    'enrollments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'programId', program_id,
        'customDailyReps', custom_daily_reps,
        'startedOn', started_on,
        'endedOn', ended_on,
        'recordedTimeZone', recorded_time_zone,
        'createdAt', created_at
      ) order by started_on, created_at)
      from public.goal_enrollments where user_id = v_user
    ), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientSetId', s.client_set_id,
        'startedAt', (extract(epoch from s.started_at) * 1000)::bigint,
        'timeZone', s.recorded_time_zone,
        'countedReps', m.good_or_better_reps,
        'receivedAt', (extract(epoch from s.received_at) * 1000)::bigint
      ) order by s.started_at, s.client_set_id)
      from public.sets s
      join public.set_metrics m on m.set_id = s.id
      where s.user_id = v_user
    ), '[]'::jsonb)
  );
end $$;

-- user_stats counted shallow reps and "any set is a streak day". my_progress replaces it.
drop view public.user_stats;

alter table public.programs enable row level security;
alter table public.program_segments enable row level security;
alter table public.goal_enrollments enable row level security;

create policy programs_read on public.programs for select to anon, authenticated using (true);
create policy program_segments_read on public.program_segments for select to anon, authenticated using (true);
create policy goal_enrollments_read on public.goal_enrollments for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.programs, public.program_segments, public.goal_enrollments from public, anon, authenticated;
grant select on public.programs, public.program_segments to anon, authenticated;
grant select on public.goal_enrollments to authenticated;

revoke all on public.daily_totals, public.weekly_totals, public.monthly_totals, public.goal_for_date from public, anon, authenticated;
grant select on public.daily_totals, public.weekly_totals, public.monthly_totals, public.goal_for_date to authenticated;

revoke all on function public.my_progress(), public.enroll_goal(jsonb), public.tg_sets_fill_time_zone() from public, anon, authenticated;
grant execute on function public.my_progress(), public.enroll_goal(jsonb) to authenticated;
