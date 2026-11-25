-- Challenge detail was planning public.challenge_standings_live for every open,
-- including the other three kinds and a join to set_metrics. set_metrics windows
-- over every rep in the database, so planning one total challenge cost ~1e6 and
-- the statement timed out under load. Scoring stays computed at read time from
-- reps. A single challenge now aggregates only that challenge's sets, and
-- my_challenges(p_battle) runs only that challenge's kind.
--
-- register_push_token used to delete and upsert on every call. The client was
-- calling it in a loop, and those ROW EXCLUSIVE locks piled up behind any
-- ACCESS EXCLUSIVE on push_tokens. The same token on the same device is now a read.

create or replace function private.upload_grace_s()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400);
$$;

-- Good-or-better plausible reps for one set. Same predicate as
-- set_metrics.good_or_better_reps. plpgsql so the set id stays a parameter and
-- the rep_metrics windows are not planned across every rep.
create or replace function private.counted_reps(p_set_id uuid)
returns integer
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if p_set_id is null then
    return 0;
  end if;
  select count(*) filter (where rm.quality >= 'good' and rm.implausible_reason is null)::integer
    into n
  from public.rep_metrics rm
  where rm.set_id = p_set_id;
  return coalesce(n, 0);
end
$$;

create type private.live_standing as (
  challenge_id uuid,
  user_id uuid,
  participant_status public.invite_status,
  challenge_status public.challenge_status,
  metric public.challenge_metric,
  best_set_id uuid,
  valid_reps integer,
  avg_depth_pct integer,
  tempo_score numeric,
  metric_value numeric,
  attempts_used integer,
  rank integer,
  days_survived integer,
  eliminated_on date,
  team_total integer,
  team_target integer
);

create or replace function private.standings_best_set(p_id uuid)
returns setof private.live_standing
language sql
stable
security invoker
set search_path = public
as $$
  with valid as (
    select rm.set_id, rm.rep_index, rm.depth_pct, rm.completed_ms,
           rm.completed_ms - lag(rm.completed_ms) over (partition by rm.set_id order by rm.rep_index) as valid_interval_ms
    from public.rep_metrics rm
    join public.challenges b on b.id = rm.challenge_id
    where b.id = p_id
      and b.kind = 'best_set'
      and rm.implausible_reason is null
      and rm.quality >= b.min_quality
      and (b.duration_s is null or rm.completed_ms <= b.duration_s * 1000)
  ), entry_sets as (
    select s.id as entry_set_id, s.challenge_id, s.user_id, s.ended_at
    from public.sets s
    join public.challenges b on b.id = s.challenge_id
    where b.id = p_id
      and b.kind = 'best_set'
      and (b.mode <> 'live'
           or abs(extract(epoch from s.started_at - b.starts_at) + coalesce(s.clock_offset_ms, 0) / 1000.0) <= 30)
  ), entries as (
    select e.challenge_id, e.user_id, e.entry_set_id,
           count(v.rep_index) as valid_reps,
           avg(v.depth_pct) as avg_depth_pct,
           stddev_pop(v.depth_pct) as depth_std_pct,
           count(v.valid_interval_ms) as interval_count,
           avg(v.valid_interval_ms) as avg_interval_ms,
           stddev_pop(v.valid_interval_ms) as interval_std_ms,
           max(e.ended_at) as finished_at
    from entry_sets e
    left join valid v on v.set_id = e.entry_set_id
    group by e.challenge_id, e.user_id, e.entry_set_id
  ), scored as (
    select en.*,
           public.battle_metric_value(b.metric, b.scoring_version, b.min_reps_for_ranking,
               en.valid_reps, en.avg_depth_pct, en.depth_std_pct,
               en.interval_count, en.avg_interval_ms, en.interval_std_ms, b.form_weights) as metric_value,
           public.tempo_score(en.interval_count, en.avg_interval_ms, en.interval_std_ms) as tempo_score
    from entries en
    join public.challenges b on b.id = en.challenge_id
  ), best as (
    select distinct on (challenge_id, user_id) *
    from scored
    order by challenge_id, user_id, metric_value desc nulls last, valid_reps desc,
             tempo_score desc nulls last, finished_at asc
  )
  select p.challenge_id, p.user_id, p.status, b.status, b.metric,
         x.entry_set_id,
         coalesce(x.valid_reps, 0)::integer,
         round(x.avg_depth_pct)::integer,
         x.tempo_score,
         x.metric_value,
         (select count(*) from public.sets s where s.challenge_id = p.challenge_id and s.user_id = p.user_id)::integer,
         (rank() over (partition by p.challenge_id
                       order by x.metric_value desc nulls last, x.valid_reps desc nulls last,
                                x.tempo_score desc nulls last))::integer,
         null::integer,
         null::date,
         null::integer,
         null::integer
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.id = p_id and b.kind = 'best_set'
  left join best x on x.challenge_id = p.challenge_id and x.user_id = p.user_id
  where p.status in ('accepted', 'forfeited');
$$;

create or replace function private.standings_total(p_id uuid)
returns setof private.live_standing
language sql
stable
security invoker
set search_path = public
as $$
  select p.challenge_id, p.user_id, p.status, b.status,
         null::public.challenge_metric,
         null::uuid,
         w.valid_reps,
         null::integer,
         null::numeric,
         w.valid_reps::numeric,
         w.attempts_used,
         (rank() over (partition by p.challenge_id order by w.valid_reps desc))::integer,
         null::integer,
         null::date,
         null::integer,
         null::integer
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.id = p_id and b.kind = 'total'
  cross join lateral (
    select coalesce(sum(private.counted_reps(s.id)), 0)::integer as valid_reps,
           count(s.id)::integer as attempts_used
    from public.sets s
    where s.user_id = p.user_id
      and s.started_at >= b.starts_at
      and s.started_at < b.ends_at
      and s.received_at <= b.ends_at + make_interval(secs => private.upload_grace_s())
      and (p.left_at is null or s.started_at < p.left_at)
  ) w
  where p.status in ('accepted', 'forfeited');
$$;

create or replace function private.standings_team(p_id uuid)
returns setof private.live_standing
language sql
stable
security invoker
set search_path = public
as $$
  select p.challenge_id, p.user_id, p.status, b.status,
         null::public.challenge_metric,
         null::uuid,
         w.valid_reps,
         null::integer,
         null::numeric,
         w.valid_reps::numeric,
         w.attempts_used,
         (case when p.status = 'forfeited' then 2 else 1 end)::integer,
         null::integer,
         null::date,
         sum(w.valid_reps) over (partition by p.challenge_id)::integer,
         b.target_reps
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.id = p_id and b.kind = 'team'
  cross join lateral (
    select coalesce(sum(private.counted_reps(s.id)), 0)::integer as valid_reps,
           count(s.id)::integer as attempts_used
    from public.sets s
    where s.user_id = p.user_id
      and s.started_at >= b.starts_at
      and s.started_at < b.ends_at
      and s.received_at <= b.ends_at + make_interval(secs => private.upload_grace_s())
      and (p.left_at is null or s.started_at < p.left_at)
  ) w
  where p.status in ('accepted', 'forfeited');
$$;

create or replace function private.standings_streak(p_id uuid)
returns setof private.live_standing
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select private.upload_grace_s() as grace_s
  ), streak_people as (
    select p.challenge_id, p.user_id, p.status as participant_status, b.status as challenge_status,
           coalesce(p.streak_floor_reps, 1) as floor_reps,
           coalesce(nullif(btrim(p.joined_time_zone), ''), 'UTC') as zone,
           p.responded_at, p.left_at, b.starts_at, b.ends_at, cfg.grace_s,
           greatest(
             (coalesce(p.responded_at, b.starts_at) at time zone coalesce(nullif(btrim(p.joined_time_zone), ''), 'UTC'))::date,
             (b.starts_at at time zone coalesce(nullif(btrim(p.joined_time_zone), ''), 'UTC'))::date
           ) as first_date,
           ((b.ends_at at time zone coalesce(nullif(btrim(p.joined_time_zone), ''), 'UTC'))::date - 1) as last_date
    from public.challenge_participants p
    join public.challenges b on b.id = p.challenge_id and b.id = p_id and b.kind = 'streak'
    cross join cfg
    where p.status in ('accepted', 'forfeited')
  ), streak_days as (
    select sp.*, gs::date as local_date
    from streak_people sp
    join lateral generate_series(sp.first_date::timestamp, sp.last_date::timestamp, interval '1 day') as gs
      on sp.first_date <= sp.last_date
  ), day_eval as (
    select sd.challenge_id, sd.user_id, sd.local_date, sd.floor_reps,
           reps.reps,
           (now() > ((sd.local_date + 1)::timestamp at time zone sd.zone) + make_interval(secs => sd.grace_s)) as closed,
           (sd.left_at is null or sd.left_at > ((sd.local_date + 1)::timestamp at time zone sd.zone)) as kept
    from streak_days sd
    join lateral (
      select coalesce(sum(private.counted_reps(s.id)), 0)::integer as reps
      from public.sets s
      where s.user_id = sd.user_id
        and s.started_at >= sd.starts_at
        and s.started_at < sd.ends_at
        and (s.started_at at time zone sd.zone)::date = sd.local_date
        and s.received_at <= ((sd.local_date + 1)::timestamp at time zone sd.zone) + make_interval(secs => sd.grace_s)
        and s.received_at <= sd.ends_at + make_interval(secs => sd.grace_s)
        and (sd.left_at is null or s.started_at < sd.left_at)
    ) reps on true
  ), streak_progress as (
    select challenge_id, user_id,
           count(*) filter (
             where closed and kept and reps >= floor_reps
               and local_date < coalesce(stop_on, 'infinity'::date)
           )::integer as days_survived,
           min(local_date) filter (where closed and not (kept and reps >= floor_reps)) as miss_on
    from (
      select d.*,
             min(d.local_date) filter (where not (d.closed and d.kept and d.reps >= d.floor_reps))
               over (partition by d.challenge_id, d.user_id) as stop_on
      from day_eval d
    ) marked
    group by challenge_id, user_id
  ), streak_reps as (
    select sp.challenge_id, sp.user_id,
           coalesce(sum(private.counted_reps(s.id)), 0)::integer as valid_reps,
           count(s.id)::integer as attempts_used
    from streak_people sp
    left join public.sets s
      on s.user_id = sp.user_id
     and s.started_at >= sp.starts_at
     and s.started_at < sp.ends_at
     and s.received_at <= sp.ends_at + make_interval(secs => sp.grace_s)
     and (s.started_at at time zone sp.zone)::date >= sp.first_date
     and (sp.left_at is null or s.started_at < sp.left_at)
    group by sp.challenge_id, sp.user_id
  ), streak_ranked as (
    select sp.challenge_id, sp.user_id, sp.participant_status, sp.challenge_status,
           coalesce(sr.valid_reps, 0) as valid_reps,
           coalesce(sr.attempts_used, 0) as attempts_used,
           coalesce(pg.days_survived, 0) as days_survived,
           coalesce(pg.miss_on, case when sp.participant_status = 'forfeited'
             then (sp.left_at at time zone sp.zone)::date end) as eliminated_on
    from streak_people sp
    left join streak_progress pg on pg.challenge_id = sp.challenge_id and pg.user_id = sp.user_id
    left join streak_reps sr on sr.challenge_id = sp.challenge_id and sr.user_id = sp.user_id
  )
  select challenge_id, user_id, participant_status, challenge_status,
         null::public.challenge_metric,
         null::uuid,
         valid_reps,
         null::integer,
         null::numeric,
         days_survived::numeric,
         attempts_used,
         (rank() over (partition by challenge_id
                       order by (participant_status = 'accepted' and eliminated_on is null) desc,
                                days_survived desc,
                                valid_reps desc))::integer,
         days_survived,
         eliminated_on,
         null::integer,
         null::integer
  from streak_ranked;
$$;

-- One kind only. The other three functions are not planned.
create or replace function private.standings_one(p_id uuid, p_kind public.challenge_kind)
returns setof private.live_standing
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_kind = 'best_set' then
    return query select * from private.standings_best_set(p_id);
  elsif p_kind = 'total' then
    return query select * from private.standings_total(p_id);
  elsif p_kind = 'streak' then
    return query select * from private.standings_streak(p_id);
  elsif p_kind = 'team' then
    return query select * from private.standings_team(p_id);
  end if;
end
$$;

-- challenge_id is challenges.id so a filter on the view restricts the lateral
-- to that row before any rep aggregate. Wrong-kind arms miss the primary key.
create or replace view public.challenge_standings_live with (security_invoker = true) as
select c.id as challenge_id, s.user_id, s.participant_status, s.challenge_status, s.metric,
       s.best_set_id, s.valid_reps, s.avg_depth_pct, s.tempo_score, s.metric_value,
       s.attempts_used, s.rank, s.days_survived, s.eliminated_on, s.team_total, s.team_target
from public.challenges c
join lateral private.standings_best_set(c.id) s on s.challenge_id = c.id
where c.kind = 'best_set'
union all
select c.id, s.user_id, s.participant_status, s.challenge_status, s.metric,
       s.best_set_id, s.valid_reps, s.avg_depth_pct, s.tempo_score, s.metric_value,
       s.attempts_used, s.rank, s.days_survived, s.eliminated_on, s.team_total, s.team_target
from public.challenges c
join lateral private.standings_total(c.id) s on s.challenge_id = c.id
where c.kind = 'total'
union all
select c.id, s.user_id, s.participant_status, s.challenge_status, s.metric,
       s.best_set_id, s.valid_reps, s.avg_depth_pct, s.tempo_score, s.metric_value,
       s.attempts_used, s.rank, s.days_survived, s.eliminated_on, s.team_total, s.team_target
from public.challenges c
join lateral private.standings_streak(c.id) s on s.challenge_id = c.id
where c.kind = 'streak'
union all
select c.id, s.user_id, s.participant_status, s.challenge_status, s.metric,
       s.best_set_id, s.valid_reps, s.avg_depth_pct, s.tempo_score, s.metric_value,
       s.attempts_used, s.rank, s.days_survived, s.eliminated_on, s.team_total, s.team_target
from public.challenges c
join lateral private.standings_team(c.id) s on s.challenge_id = c.id
where c.kind = 'team';

create or replace function private.challenge_rows(p_id uuid)
returns setof public.challenge_standings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind public.challenge_kind;
  v_status public.challenge_status;
begin
  if (select auth.uid()) is not null
     and not private.is_challenge_member(p_id)
     and not exists (select 1 from public.challenges c where c.id = p_id and c.created_by = (select auth.uid()))
  then
    return;
  end if;

  select c.kind, c.status into v_kind, v_status
  from public.challenges c
  where c.id = p_id;
  if not found then
    return;
  end if;

  -- Finished challenges are the locked snapshot. Do not recompute live rows.
  if v_status = 'completed' then
    return query
    select r.challenge_id, r.user_id, r.participant_status,
           'completed'::public.challenge_status,
           r.metric, r.best_set_id, r.valid_reps, r.avg_depth_pct, r.tempo_score, r.metric_value,
           r.attempts_used, r.rank, r.is_winner, true, r.locked_at,
           r.days_survived, r.eliminated_on, r.team_total, r.team_target
    from public.challenge_results r
    where r.challenge_id = p_id;
    return;
  end if;

  return query
  select l.challenge_id, l.user_id, l.participant_status, l.challenge_status,
         l.metric, l.best_set_id, l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value,
         l.attempts_used, l.rank, false, false, null::timestamptz,
         l.days_survived, l.eliminated_on, l.team_total, l.team_target
  from private.standings_one(p_id, v_kind) l;
end
$$;

create or replace function public.register_push_token(p_device_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.devices d
    where d.id = p_device_id and d.user_id = v_user
  ) then
    raise exception 'unknown device';
  end if;

  -- Same token, still enabled, on this device only: read and return.
  -- Skipping the write avoids ROW EXCLUSIVE on public.push_tokens.
  if exists (
       select 1 from public.push_tokens t
       where t.device_id = p_device_id
         and t.expo_push_token = p_token
         and t.disabled_at is null
     )
     and not exists (
       select 1 from public.push_tokens t
       where t.expo_push_token = p_token
         and t.device_id <> p_device_id
     )
  then
    return;
  end if;

  -- The token belongs to the phone. Drop it from a previous account's device
  -- only when that row is actually there.
  delete from public.push_tokens
   where expo_push_token = p_token
     and device_id <> p_device_id;

  insert into public.push_tokens (device_id, expo_push_token)
  values (p_device_id, p_token)
  on conflict (device_id) do update
    set expo_push_token = excluded.expo_push_token,
        updated_at = now(),
        disabled_at = null
  where public.push_tokens.expo_push_token is distinct from excluded.expo_push_token
     or public.push_tokens.disabled_at is not null;
end
$$;

revoke all on function private.upload_grace_s() from public, anon;
revoke all on function private.counted_reps(uuid) from public, anon;
revoke all on function private.standings_best_set(uuid) from public, anon;
revoke all on function private.standings_total(uuid) from public, anon;
revoke all on function private.standings_streak(uuid) from public, anon;
revoke all on function private.standings_team(uuid) from public, anon;
revoke all on function private.standings_one(uuid, public.challenge_kind) from public, anon;
grant execute on function private.upload_grace_s() to authenticated, service_role;
grant execute on function private.counted_reps(uuid) to authenticated, service_role;
grant execute on function private.standings_best_set(uuid) to authenticated, service_role;
grant execute on function private.standings_total(uuid) to authenticated, service_role;
grant execute on function private.standings_streak(uuid) to authenticated, service_role;
grant execute on function private.standings_team(uuid) to authenticated, service_role;
grant execute on function private.standings_one(uuid, public.challenge_kind) to authenticated, service_role;
