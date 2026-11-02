-- Slice 6: streak face-offs and team goals. No new tables.
-- Scores are computed when read. finalize_challenges copies them into challenge_results.
-- A Sunday rest does not freeze a streak floor at 0: the floor is the training-day target.

-- A local midnight span can be an hour off across daylight saving. The 3-hour cushion
-- keeps a legal 3-day or 92-day face-off from failing the check.
alter table public.challenges drop constraint challenges_streak_span;
alter table public.challenges add constraint challenges_streak_span
  check (kind <> 'streak' or (
    ends_at is not null and starts_at is not null
    and ends_at - starts_at >= interval '3 days' - interval '3 hours'
    and ends_at - starts_at <= interval '92 days' + interval '3 hours'));

-- Training-day target of the goal covering today in the profile zone. Null when there
-- is no goal. Rest weekdays do not reduce it.
create or replace function private.streak_floor(p_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_zone text;
  v_today date;
  v_enroll public.goal_enrollments;
  v_target integer;
  v_day integer;
begin
  select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone
    from public.profiles where id = p_user;
  if v_zone is null then
    return null;
  end if;
  v_today := (now() at time zone v_zone)::date;

  select * into v_enroll
    from public.goal_enrollments
   where user_id = p_user
     and started_on <= v_today
     and (ended_on is null or v_today < ended_on)
   order by started_on desc
   limit 1;
  if not found then
    return null;
  end if;

  if v_enroll.custom_daily_reps is not null then
    v_target := v_enroll.custom_daily_reps;
  else
    v_day := (v_today - v_enroll.started_on) + 1;
    select s.daily_target into v_target
      from public.program_segments s
      join public.programs pr on pr.id = s.program_id
     where s.program_id = v_enroll.program_id
       and (
         v_day between s.day_from and s.day_to
         or (
           pr.maintains_after
           and v_day > (select max(day_to) from public.program_segments where program_id = v_enroll.program_id)
           and s.day_to = (select max(day_to) from public.program_segments where program_id = v_enroll.program_id)
         )
       )
     order by s.segment_index
     limit 1;
  end if;
  if v_target is null or v_target < 1 then
    return null;
  end if;
  return v_target;
end $$;

revoke all on function private.streak_floor(uuid) from public, anon, authenticated;

create or replace function public.tg_participant_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.challenges;
  n int;
  v_floor integer;
  v_zone text;
begin
  select * into b from public.challenges where id = new.challenge_id;
  if tg_op = 'INSERT' then
    select count(*) into n from public.challenge_participants
     where challenge_id = new.challenge_id and status in ('invited', 'accepted');
    if n >= b.max_participants then
      raise exception 'challenge is full';
    end if;
    if b.kind = 'streak' and new.status = 'accepted' then
      v_floor := private.streak_floor(new.user_id);
      if v_floor is null then
        raise exception 'a streak face-off needs a goal';
      end if;
      new.streak_floor_reps := v_floor;
      select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone
        from public.profiles where id = new.user_id;
      new.joined_time_zone := coalesce(v_zone, 'UTC');
    else
      new.streak_floor_reps := null;
      new.joined_time_zone := null;
    end if;
    return new;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;
  if pg_trigger_depth() > 1
     and (new.invited_by is null or new.invited_by = old.invited_by)
     and (new.invite_link_token is null or new.invite_link_token = old.invite_link_token)
     and (to_jsonb(new) - 'invited_by' - 'invite_link_token')
       = (to_jsonb(old) - 'invited_by' - 'invite_link_token') then
    return new;
  end if;
  if new.challenge_id <> old.challenge_id or new.user_id <> old.user_id
     or new.invited_by is distinct from old.invited_by
     or new.invite_link_token is distinct from old.invite_link_token
     or new.invited_at <> old.invited_at then
    raise exception 'immutable participant fields';
  end if;

  if new.status <> old.status then
    if old.status = 'invited' and new.status in ('accepted', 'declined') then
      if b.status not in ('pending', 'active') or now() >= b.invite_expires_at then
        raise exception 'invite no longer open';
      end if;
      new.responded_at := now();
    elsif old.status = 'accepted' and new.status = 'forfeited' then
      new.left_at := now();
      new.ready_at := null;
    else
      raise exception 'invalid participant transition % -> %', old.status, new.status;
    end if;
  end if;

  if old.status = 'invited' and new.status = 'accepted' and b.kind = 'streak' then
    v_floor := private.streak_floor(new.user_id);
    if v_floor is null then
      raise exception 'a streak face-off needs a goal';
    end if;
    new.streak_floor_reps := v_floor;
    select coalesce(nullif(btrim(time_zone), ''), 'UTC') into v_zone
      from public.profiles where id = new.user_id;
    new.joined_time_zone := coalesce(v_zone, 'UTC');
  elsif new.streak_floor_reps is distinct from old.streak_floor_reps
     or new.joined_time_zone is distinct from old.joined_time_zone then
    raise exception 'immutable participant fields';
  end if;

  if new.ready_at is distinct from old.ready_at then
    if b.mode <> 'live' or b.status <> 'active' or b.starts_at is not null then
      raise exception 'ready only in an active live lobby before the start';
    end if;
    if new.ready_at is not null then
      new.ready_at := now();
    end if;
  end if;
  return new;
end $$;

create or replace function public.create_challenge(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_me       uuid := private.me();
  d          jsonb := coalesce(public.setting('async_battle_defaults'), '{}');
  v_team     jsonb := coalesce(public.setting('team_targets'), '{}'::jsonb);
  v_streak   jsonb := coalesce(public.setting('streak_lengths'), '{}'::jsonb);
  v_kind     public.challenge_kind;
  v_window   public.challenge_window;
  v_metric   public.challenge_metric;
  v_duration integer;
  v_hours    numeric := coalesce((p->>'deadlineHours')::numeric, (d->>'deadline_hours')::numeric, 24);
  v_max_days integer := least(greatest(coalesce((public.setting('challenge_custom_max_days'))::text::integer, 92), 1), 366);
  v_max      integer := coalesce((p->>'maxParticipants')::integer, (public.setting('async_max_participants'))::text::integer, 8);
  v_friends  uuid[] := coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(p->'friendIds', '[]')) x), '{}');
  v_link     boolean := coalesce((p->>'inviteLink')::boolean, false);
  v_zone     text;
  v_local    timestamp;
  v_start_local timestamp;
  v_end_local timestamp;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_id       uuid;
  v_token    text;
  v_score    smallint := coalesce((public.setting('scoring_version'))::text::smallint, 1);
  v_days     integer;
  v_min_days integer;
  v_max_span integer;
  v_target   integer;
  v_min_t    integer;
  v_max_t    integer;
begin
  if coalesce(p->>'mode', 'async') <> 'async' then
    raise exception 'live battles are not available yet';
  end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'pick a username first';
  end if;
  begin
    v_kind := (p->>'kind')::public.challenge_kind;
  exception when others then
    raise exception 'kind must be best_set, total, streak, or team';
  end;
  if v_kind is null then
    raise exception 'kind must be best_set, total, streak, or team';
  end if;

  select coalesce(time_zone, 'UTC') into v_zone from public.profiles where id = v_me;
  if v_kind = 'best_set' then
    v_metric := coalesce(p->>'metric', 'rep_count')::public.challenge_metric;
    if p ? 'durationS' and nullif(p->>'durationS', '') is not null then
      v_duration := (p->>'durationS')::integer;
      if v_duration is null or not (coalesce(d->'timed_durations_s', '[60,120]') @> to_jsonb(v_duration)) then
        raise exception 'timed battles last % seconds', coalesce(d->'timed_durations_s', '[60,120]');
      end if;
      v_metric := 'rep_count';
    end if;
    if v_hours <= 0 or v_hours > coalesce((d->>'max_deadline_hours')::numeric, 168) then
      raise exception 'deadline must be within % hours', coalesce((d->>'max_deadline_hours')::numeric, 168);
    end if;
    v_ends := now() + make_interval(secs => v_hours * 3600);
  elsif v_kind = 'streak' then
    v_metric := null;
    v_min_days := coalesce((v_streak->>'min_days')::integer, 3);
    v_max_span := coalesce((v_streak->>'max_days')::integer, 92);
    v_days := coalesce((p->>'streakDays')::integer, 7);
    if v_days < v_min_days or v_days > v_max_span then
      raise exception 'a streak face-off is % to % days', v_min_days, v_max_span;
    end if;
    v_local := now() at time zone v_zone;
    v_start_local := date_trunc('day', v_local);
    v_end_local := v_start_local + make_interval(days => v_days);
    v_starts := v_start_local at time zone v_zone;
    v_ends := v_end_local at time zone v_zone;
  else
    v_metric := null;
    begin
      if nullif(p->>'window', '') is null and v_kind = 'team' then
        v_window := coalesce((v_team->>'default_window')::public.challenge_window, 'week');
      else
        v_window := (p->>'window')::public.challenge_window;
      end if;
    exception when others then
      raise exception 'window must be day, week, month, or custom';
    end;
    if v_window is null then
      raise exception 'window must be day, week, month, or custom';
    end if;
    v_local := now() at time zone v_zone;
    if v_window = 'custom' then
      v_starts := (p->>'customStartsAt')::timestamptz;
      v_ends := (p->>'customEndsAt')::timestamptz;
      if v_starts is null or v_ends is null or v_ends <= v_starts then
        raise exception 'custom window needs a start and a later end';
      end if;
      if v_ends - v_starts < interval '1 hour' then
        raise exception 'custom window must be at least 1 hour';
      end if;
      if v_ends - v_starts > make_interval(days => v_max_days) then
        raise exception 'custom window must be within % days', v_max_days;
      end if;
    else
      if v_window = 'day' then
        v_start_local := date_trunc('day', v_local);
        v_end_local := v_start_local + interval '1 day';
      elsif v_window = 'week' then
        v_start_local := date_trunc('day', v_local) - make_interval(days => extract(isodow from v_local)::int - 1);
        v_end_local := v_start_local + interval '7 days';
      else
        v_start_local := date_trunc('month', v_local);
        v_end_local := v_start_local + interval '1 month';
      end if;
      v_starts := v_start_local at time zone v_zone;
      v_ends := v_end_local at time zone v_zone;
    end if;
    if v_kind = 'team' then
      v_min_t := coalesce((v_team->>'min')::integer, 10);
      v_max_t := coalesce((v_team->>'max')::integer, 100000);
      v_target := coalesce((p->>'targetReps')::integer, (v_team->>'default')::integer, 500);
      if v_target < v_min_t or v_target > v_max_t then
        raise exception 'team goal must be from % to % reps', v_min_t, v_max_t;
      end if;
    end if;
  end if;

  if v_me = any(v_friends) then
    raise exception 'you are already in the battle';
  end if;
  if cardinality(v_friends) = 0 and not v_link then
    raise exception 'invite a friend or create an invite link';
  end if;
  if cardinality(v_friends) + 1 > v_max then
    raise exception 'too many players (max %)', v_max;
  end if;

  insert into public.challenges (created_by, mode, kind, metric, duration_s, attempts_allowed,
                              window_unit, anchor_time_zone, target_reps, max_participants, invite_expires_at,
                              starts_at, ends_at, scoring_version)
  values (v_me, 'async', v_kind, v_metric, v_duration,
          case when v_kind = 'best_set' then coalesce((d->>'attempts_allowed')::smallint, 1) else null end,
          case when v_kind in ('total', 'team') then v_window else null end,
          case when v_kind in ('total', 'team', 'streak') then v_zone else null end,
          v_target, v_max,
          least(now() + make_interval(secs => coalesce((d->>'invite_expiry_hours')::numeric, 24) * 3600), v_ends),
          v_starts, v_ends, v_score)
  returning id into v_id;

  insert into public.challenge_participants (challenge_id, user_id, invited_by)
  select v_id, f, v_me from unnest(v_friends) f;

  if v_link then
    insert into public.challenge_invite_links (challenge_id, created_by, max_uses, expires_at)
    values (v_id, v_me,
            least(greatest(coalesce((p->>'linkMaxUses')::integer, (d->>'link_max_uses')::integer, 7), 1), 7, v_max - 1),
            least(now() + make_interval(secs => coalesce((d->>'invite_expiry_hours')::numeric, 24) * 3600), v_ends))
    returning token into v_token;
  end if;
  return jsonb_build_object('challengeId', v_id, 'inviteToken', v_token);
end $$;

-- Live standings gain streak and team columns at the end. total and best_set leave them null.
create or replace view public.challenge_standings_live with (security_invoker = true) as
with cfg as (
  select least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400) as grace_s
), scored as (
  select be.*,
         public.battle_metric_value(b.metric, b.scoring_version, b.min_reps_for_ranking,
             be.valid_reps, be.avg_depth_pct, be.depth_std_pct,
             be.interval_count, be.avg_interval_ms, be.interval_std_ms, b.form_weights) as metric_value,
         public.tempo_score(be.interval_count, be.avg_interval_ms, be.interval_std_ms) as tempo_score
  from public.challenge_entries be
  join public.challenges b on b.id = be.challenge_id
), best as (
  select distinct on (challenge_id, user_id) *
  from scored
  order by challenge_id, user_id, metric_value desc nulls last, valid_reps desc,
           tempo_score desc nulls last, finished_at asc
), best_rows as (
  select p.challenge_id, p.user_id, p.status as participant_status, b.status as challenge_status, b.metric,
         x.entry_set_id as best_set_id,
         coalesce(x.valid_reps, 0)::integer as valid_reps,
         round(x.avg_depth_pct)::integer as avg_depth_pct,
         x.tempo_score,
         x.metric_value,
         (select count(*) from public.sets s where s.challenge_id = p.challenge_id and s.user_id = p.user_id)::integer as attempts_used,
         (rank() over (partition by p.challenge_id
                       order by x.metric_value desc nulls last, x.valid_reps desc nulls last,
                                x.tempo_score desc nulls last))::integer as rank,
         null::integer as days_survived,
         null::date as eliminated_on,
         null::integer as team_total,
         null::integer as team_target
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.kind = 'best_set'
  left join best x on x.challenge_id = p.challenge_id and x.user_id = p.user_id
  where p.status in ('accepted', 'forfeited')
), window_reps as (
  select b.id as challenge_id, p.user_id,
         coalesce(sum(sm.good_or_better_reps), 0)::integer as valid_reps,
         count(s.id)::integer as attempts_used
  from public.challenges b
  join public.challenge_participants p
    on p.challenge_id = b.id and p.status in ('accepted', 'forfeited')
  left join public.sets s
    on s.user_id = p.user_id
   and s.started_at >= b.starts_at
   and s.started_at < b.ends_at
   and s.received_at <= b.ends_at + make_interval(secs => least(greatest(
         coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400))
   and (p.left_at is null or s.started_at < p.left_at)
  left join public.set_metrics sm on sm.set_id = s.id
  where b.kind in ('total', 'team')
  group by b.id, p.user_id
), total_rows as (
  select p.challenge_id, p.user_id, p.status as participant_status, b.status as challenge_status,
         null::public.challenge_metric as metric,
         null::uuid as best_set_id,
         coalesce(w.valid_reps, 0) as valid_reps,
         null::integer as avg_depth_pct,
         null::numeric as tempo_score,
         coalesce(w.valid_reps, 0)::numeric as metric_value,
         coalesce(w.attempts_used, 0) as attempts_used,
         (rank() over (partition by p.challenge_id order by coalesce(w.valid_reps, 0) desc))::integer as rank,
         null::integer as days_survived,
         null::date as eliminated_on,
         null::integer as team_total,
         null::integer as team_target
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.kind = 'total'
  left join window_reps w on w.challenge_id = p.challenge_id and w.user_id = p.user_id
  where p.status in ('accepted', 'forfeited')
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
  join public.challenges b on b.id = p.challenge_id and b.kind = 'streak'
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
    select coalesce(sum(sm.good_or_better_reps), 0)::integer as reps
    from public.sets s
    left join public.set_metrics sm on sm.set_id = s.id
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
         coalesce(sum(sm.good_or_better_reps), 0)::integer as valid_reps,
         count(s.id)::integer as attempts_used
  from streak_people sp
  left join public.sets s
    on s.user_id = sp.user_id
   and s.started_at >= sp.starts_at
   and s.started_at < sp.ends_at
   and s.received_at <= sp.ends_at + make_interval(secs => sp.grace_s)
   and (s.started_at at time zone sp.zone)::date >= sp.first_date
   and (sp.left_at is null or s.started_at < sp.left_at)
  left join public.set_metrics sm on sm.set_id = s.id
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
), streak_rows as (
  select challenge_id, user_id, participant_status, challenge_status,
         null::public.challenge_metric as metric,
         null::uuid as best_set_id,
         valid_reps,
         null::integer as avg_depth_pct,
         null::numeric as tempo_score,
         days_survived::numeric as metric_value,
         attempts_used,
         (rank() over (partition by challenge_id
                       order by (participant_status = 'accepted' and eliminated_on is null) desc,
                                days_survived desc,
                                valid_reps desc))::integer as rank,
         days_survived,
         eliminated_on,
         null::integer as team_total,
         null::integer as team_target
  from streak_ranked
), team_rows as (
  select p.challenge_id, p.user_id, p.status as participant_status, b.status as challenge_status,
         null::public.challenge_metric as metric,
         null::uuid as best_set_id,
         coalesce(w.valid_reps, 0) as valid_reps,
         null::integer as avg_depth_pct,
         null::numeric as tempo_score,
         coalesce(w.valid_reps, 0)::numeric as metric_value,
         coalesce(w.attempts_used, 0) as attempts_used,
         (case when p.status = 'forfeited' then 2 else 1 end)::integer as rank,
         null::integer as days_survived,
         null::date as eliminated_on,
         sum(coalesce(w.valid_reps, 0)) over (partition by p.challenge_id)::integer as team_total,
         b.target_reps as team_target
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.kind = 'team'
  left join window_reps w on w.challenge_id = p.challenge_id and w.user_id = p.user_id
  where p.status in ('accepted', 'forfeited')
)
select * from best_rows
union all
select * from total_rows
union all
select * from streak_rows
union all
select * from team_rows;

create or replace view public.challenge_standings with (security_invoker = true) as
select r.challenge_id, r.user_id, r.participant_status, 'completed'::public.challenge_status as challenge_status,
       r.metric, r.best_set_id, r.valid_reps, r.avg_depth_pct, r.tempo_score, r.metric_value,
       r.attempts_used, r.rank, r.is_winner, true as locked, r.locked_at,
       r.days_survived, r.eliminated_on, r.team_total, r.team_target
from public.challenge_results r
union all
select l.challenge_id, l.user_id, l.participant_status, l.challenge_status,
       l.metric, l.best_set_id, l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value,
       l.attempts_used, l.rank, false as is_winner, false as locked, null::timestamptz as locked_at,
       l.days_survived, l.eliminated_on, l.team_total, l.team_target
from public.challenge_standings_live l
where l.challenge_status <> 'completed';

create or replace function private.challenge_rows(p_id uuid)
returns setof public.challenge_standings
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and not private.is_challenge_member(p_id)
     and not exists (select 1 from public.challenges c where c.id = p_id and c.created_by = (select auth.uid()))
  then
    return;
  end if;
  return query select * from public.challenge_standings where challenge_id = p_id;
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
  return n;
end $$;

create or replace function public.my_challenges(p_battle uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', b.id, 'mode', b.mode, 'kind', b.kind, 'windowUnit', b.window_unit,
      'metric', b.metric, 'status', b.status,
      'durationS', b.duration_s, 'attemptsAllowed', b.attempts_allowed,
      'targetReps', b.target_reps, 'startsAt', b.starts_at,
      'maxParticipants', b.max_participants, 'minQuality', b.min_quality,
      'inviteExpiresAt', b.invite_expires_at, 'endsAt', b.ends_at, 'createdAt', b.created_at,
      'finishedAt', b.finished_at, 'createdBy', b.created_by,
      'locked', b.status = 'completed',
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'userId', p.user_id, 'username', pr.username, 'displayName', pr.display_name,
                 'status', p.status, 'isMe', p.user_id = (select auth.uid()),
                 'attemptsUsed', coalesce(s.attempts_used, 0),
                 'validReps', s.valid_reps, 'metricValue', s.metric_value, 'avgDepthPct', s.avg_depth_pct,
                 'tempoScore', s.tempo_score, 'rank', s.rank, 'isWinner', coalesce(s.is_winner, false),
                 'streakFloorReps', p.streak_floor_reps,
                 'daysSurvived', s.days_survived,
                 'eliminatedOn', s.eliminated_on,
                 'teamTotal', s.team_total,
                 'teamTarget', s.team_target)
               order by s.rank nulls last, pr.username), '[]'::jsonb)
          from public.challenge_participants p
          left join public.profiles pr on pr.id = p.user_id
          left join private.challenge_rows(b.id) s on s.user_id = p.user_id
         where p.challenge_id = b.id),
      'inviteLinks', case when b.created_by = (select auth.uid()) then (
        select coalesce(jsonb_agg(jsonb_build_object('token', l.token, 'maxUses', l.max_uses,
                 'expiresAt', l.expires_at,
                 'uses', (select count(*) from public.challenge_participants u where u.invite_link_token = l.token))
               order by l.created_at desc), '[]'::jsonb)
          from public.challenge_invite_links l
         where l.challenge_id = b.id and l.revoked_at is null and l.expires_at > now()) else '[]'::jsonb end
    ) as x
      from public.challenges b
     where exists (select 1 from public.challenge_participants me
                    where me.challenge_id = b.id and me.user_id = (select auth.uid()))
       and (case when p_battle is null
                 then b.status in ('pending', 'active') or b.finished_at > now() - interval '30 days'
                 else b.id = p_battle end)
     order by b.created_at desc
     limit 50) t;
$$;

create or replace function public.invite_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.challenge_invite_links;
  b public.challenges;
  v_me uuid := (select auth.uid());
begin
  select * into l from public.challenge_invite_links where token = lower(coalesce(p_token, ''));
  select * into b from public.challenges where id = l.challenge_id;
  if l.token is null or b.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', coalesce(private.invite_link_problem(l, b), 'ok'),
    'challenge', jsonb_build_object('id', b.id, 'mode', b.mode, 'kind', b.kind, 'windowUnit', b.window_unit,
                'metric', b.metric, 'durationS', b.duration_s, 'status', b.status, 'endsAt', b.ends_at,
                'startsAt', b.starts_at, 'targetReps', b.target_reps,
                'attemptsAllowed', b.attempts_allowed, 'maxParticipants', b.max_participants,
                'players', (select count(*) from public.challenge_participants p
                             where p.challenge_id = b.id and p.status = 'accepted')),
    'creator', (select jsonb_build_object('username', p.username, 'displayName', p.display_name)
                  from public.profiles p where p.id = b.created_by),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'displayName', p.display_name,
                                 'validReps', s.valid_reps, 'metricValue', s.metric_value) order by s.rank)
                          from public.challenge_standings_live s join public.profiles p on p.id = s.user_id
                         where s.challenge_id = b.id and s.attempts_used > 0), '[]'::jsonb),
    'member', v_me is not null and exists (select 1 from public.challenge_participants p
                                            where p.challenge_id = b.id and p.user_id = v_me));
end $$;

update public.app_settings
   set description = 'Streak face-off lengths.'
 where key = 'streak_lengths';

update public.app_settings
   set description = 'Team goal chips and the default shared target.'
 where key = 'team_targets';
