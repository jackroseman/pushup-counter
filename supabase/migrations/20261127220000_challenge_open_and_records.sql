-- Open-challenge opinions, duration windows, leave, and lifetime records.
-- The back end has the opinions; the front end implements the back end.

alter table public.challenges
  add column if not exists duration_days integer;

comment on column public.challenges.duration_days is
  'Local days in a start-of-day window for most reps and team (1, 7, 14, or 30). Null on leftover calendar windows and on best set.';

-- -------------------------------------------------------------------------------------
-- create_challenge: 1/7/14/30-day windows start at the creator's local midnight.
-- Invites stay open until the challenge ends. Legacy day/week/month maps to 1/7/30.
-- -------------------------------------------------------------------------------------
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
  v_duration_days integer;
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
    if nullif(p->>'window', '') = 'custom' then
      v_window := 'custom';
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
      v_duration_days := coalesce(
        (p->>'durationDays')::integer,
        case p->>'window'
          when 'day' then 1
          when 'week' then 7
          when 'month' then 30
          else null
        end,
        case when v_kind = 'team' then 7 else null end
      );
      if v_duration_days is null or v_duration_days not in (1, 7, 14, 30) then
        raise exception 'length must be 1, 7, 14, or 30 days';
      end if;
      v_local := now() at time zone v_zone;
      v_start_local := date_trunc('day', v_local);
      v_end_local := v_start_local + make_interval(days => v_duration_days);
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
                              window_unit, duration_days, anchor_time_zone, target_reps, max_participants, invite_expires_at,
                              starts_at, ends_at, scoring_version)
  values (v_me, 'async', v_kind, v_metric, v_duration,
          case when v_kind = 'best_set' then coalesce((d->>'attempts_allowed')::smallint, 1) else null end,
          v_window, v_duration_days,
          case when v_kind in ('total', 'team', 'streak') then v_zone else null end,
          v_target, v_max,
          v_ends,
          v_starts, v_ends, v_score)
  returning id into v_id;

  insert into public.challenge_participants (challenge_id, user_id, invited_by)
  select v_id, f, v_me from unnest(v_friends) f;

  if v_link then
    insert into public.challenge_invite_links (challenge_id, created_by, max_uses, expires_at)
    values (v_id, v_me,
            least(greatest(coalesce((p->>'linkMaxUses')::integer, (d->>'link_max_uses')::integer, 7), 1), 7, v_max - 1),
            v_ends)
    returning token into v_token;
  end if;
  return jsonb_build_object('challengeId', v_id, 'inviteToken', v_token);
end $$;

-- -------------------------------------------------------------------------------------
-- Leave: any accepted participant can leave (forfeit). Cancel stays pending-only.
-- -------------------------------------------------------------------------------------
create or replace function public.leave_challenge(p_battle uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.challenge_participants
     set status = 'forfeited',
         responded_at = coalesce(responded_at, now())
   where challenge_id = p_battle
     and user_id = (select auth.uid())
     and status = 'accepted';
  if not found then
    raise exception 'cannot leave';
  end if;
end $$;

revoke all on function public.leave_challenge(uuid) from public, anon;
grant execute on function public.leave_challenge(uuid) to authenticated;

-- -------------------------------------------------------------------------------------
-- my_challenges gains durationDays so rematch and titles can use the stored length.
-- -------------------------------------------------------------------------------------
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
      'durationDays', b.duration_days,
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

-- -------------------------------------------------------------------------------------
-- Helpers for open-challenge opinions.
-- -------------------------------------------------------------------------------------
create or replace function private.person_label(p_username text, p_display text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(trim(p_display), ''), case when p_username is not null then p_username end, 'Someone');
$$;

create or replace function private.challenge_title(p_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when b.kind = 'best_set' then 'Best set'
    when b.kind = 'total' and b.duration_days is not null then
      'Most reps · ' || b.duration_days::text || case when b.duration_days = 1 then ' day' else ' days' end
    when b.kind = 'total' and b.window_unit = 'day' then 'Most reps today'
    when b.kind = 'total' and b.window_unit = 'week' then 'Most reps this week'
    when b.kind = 'total' and b.window_unit = 'month' then 'Most reps this month'
    when b.kind = 'total' then 'Most reps'
    when b.kind = 'streak' then
      coalesce(
        (round(extract(epoch from (b.ends_at - b.starts_at)) / 86400))::int::text || '-day streak',
        'Streak'
      )
    when b.kind = 'team' and b.duration_days is not null then
      'Team · ' || b.duration_days::text || case when b.duration_days = 1 then ' day' else ' days' end
    when b.kind = 'team' and b.window_unit = 'day' then 'Team today'
    when b.kind = 'team' and b.window_unit = 'week' then 'Team week'
    when b.kind = 'team' and b.window_unit = 'month' then 'Team month'
    else 'Team goal'
  end
  from public.challenges b
  where b.id = p_id;
$$;

-- Today's counted reps in a streak, using the participant's joined zone (same rules as standings).
create or replace function private.today_streak_reps(p_challenge uuid, p_user uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(private.counted_reps(s.id)), 0)::integer
    from public.challenge_participants p
    join public.challenges b on b.id = p.challenge_id
    left join public.sets s
      on s.user_id = p.user_id
     and s.started_at >= b.starts_at
     and s.started_at < b.ends_at
     and (s.started_at at time zone coalesce(nullif(btrim(p.joined_time_zone), ''), coalesce(b.anchor_time_zone, 'UTC')))::date
         = (now() at time zone coalesce(nullif(btrim(p.joined_time_zone), ''), coalesce(b.anchor_time_zone, 'UTC')))::date
     and s.received_at <= b.ends_at + make_interval(secs => private.upload_grace_s())
     and (p.left_at is null or s.started_at < p.left_at)
   where p.challenge_id = p_challenge
     and p.user_id = p_user;
$$;

create or replace function public.my_open_challenges()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;
  return (
    with mine as (
      select b.*, p.status as my_status, p.streak_floor_reps,
             p.user_id as my_user_id
        from public.challenges b
        join public.challenge_participants p on p.challenge_id = b.id and p.user_id = v_me
       where b.status in ('pending', 'active')
         and p.status in ('invited', 'accepted')
    ), scored as (
      select m.*,
             l.valid_reps as my_reps,
             l.attempts_used,
             l.rank as my_rank,
             l.eliminated_on,
             l.team_total,
             l.team_target,
             l.days_survived,
             l.participant_status as standing_status
        from mine m
        left join public.challenge_standings_live l
          on l.challenge_id = m.id and l.user_id = v_me
    ), leaders as (
      select distinct on (s.id)
             s.id,
             l.user_id as leader_user_id,
             pr.username as leader_username,
             pr.display_name as leader_display_name,
             l.valid_reps as leader_reps,
             l.rank as leader_rank,
             (select count(*) from public.challenge_standings_live d
               where d.challenge_id = s.id and d.rank = 1 and d.participant_status = 'accepted') as first_place_count
        from scored s
        left join public.challenge_standings_live l
          on l.challenge_id = s.id and l.rank = 1 and l.participant_status = 'accepted'
        left join public.profiles pr on pr.id = l.user_id
       order by s.id, (l.user_id = v_me) desc, pr.username nulls last
    ), people as (
      select s.id,
             jsonb_agg(jsonb_build_object(
               'userId', cp.user_id,
               'username', pr.username,
               'displayName', pr.display_name,
               'status', cp.status,
               'isMe', cp.user_id = v_me
             ) order by (cp.user_id = v_me) desc, pr.username) as people,
             (select jsonb_build_object(
                'userId', op.user_id,
                'displayName', private.person_label(opr.username, opr.display_name)
              )
                from public.challenge_participants op
                join public.profiles opr on opr.id = op.user_id
               where op.challenge_id = s.id and op.user_id <> v_me
                 and op.status in ('invited', 'accepted')
               order by opr.username
               limit 1) as primary_opponent,
             (select count(*) from public.challenge_participants op
               where op.challenge_id = s.id and op.user_id <> v_me
                 and op.status in ('invited', 'accepted')) as other_count
        from scored s
        join public.challenge_participants cp on cp.challenge_id = s.id
        left join public.profiles pr on pr.id = cp.user_id
       group by s.id
    ), marked as (
      select s.*,
             p.people,
             p.primary_opponent,
             p.other_count,
             ld.leader_user_id,
             ld.leader_display_name,
             ld.leader_reps,
             ld.first_place_count,
             (s.my_status = 'invited' and s.status in ('pending', 'active') and s.invite_expires_at > v_now) as needs_response,
             (s.starts_at is null or s.starts_at <= v_now) and (s.ends_at is null or s.ends_at > v_now) as window_open,
             (s.status = 'active' and s.ends_at is not null and s.ends_at <= v_now) as awaiting_result
        from scored s
        join people p on p.id = s.id
        left join leaders ld on ld.id = s.id
    ), opinions as (
      select m.*,
             case
               when m.my_status <> 'accepted' then false
               when not m.window_open then false
               when m.kind = 'best_set' then
                 coalesce(m.attempts_used, 0) < coalesce(m.attempts_allowed, 1)
               when m.kind = 'total' then true
               when m.kind = 'team' then
                 coalesce(m.team_target, m.target_reps, 0) > 0
                 and coalesce(m.team_total, 0) < coalesce(m.team_target, m.target_reps)
               when m.kind = 'streak' then
                 m.eliminated_on is null
                 and coalesce(private.today_streak_reps(m.id, v_me), 0) < coalesce(m.streak_floor_reps, 1)
               else false
             end as can_do_push_ups
        from marked m
    ), shaped as (
      select o.*,
             (o.can_do_push_ups or o.needs_response) as in_action,
             greatest(0, floor(extract(epoch from (o.ends_at - v_now))))::int as time_left_s,
             private.challenge_title(o.id) as base_title,
             case
               when o.needs_response then 'accept_decline'
               when o.can_do_push_ups and o.kind = 'best_set' then 'play'
               when o.can_do_push_ups then 'start_set'
               else 'none'
             end as cta_type,
             case
               when o.needs_response then 'invited_you'
               when o.awaiting_result then 'awaiting_result'
               when o.kind = 'best_set' and o.can_do_push_ups then 'play'
               when o.kind = 'best_set' then 'waiting_on'
               when o.kind = 'total' and o.can_do_push_ups and o.leader_user_id is null then 'start'
               when o.kind = 'total' and o.first_place_count > 1 and o.my_rank = 1 then 'tied'
               when o.kind = 'total' and o.leader_user_id = v_me then 'you_lead'
               when o.kind = 'total' and o.leader_user_id is not null then 'behind'
               when o.kind = 'team' and o.can_do_push_ups then 'contribute'
               when o.kind = 'team' then 'goal_done'
               when o.kind = 'streak' and o.can_do_push_ups then 'streak_today'
               when o.kind = 'streak' then 'goal_done_today'
               else 'waiting_on'
             end as status_key
        from opinions o
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'challengeId', s.id,
      'kind', s.kind,
      'title', case
        when s.needs_response then
          coalesce((s.primary_opponent->>'displayName'), 'Someone') || ' invited you'
        when s.kind = 'best_set' and s.primary_opponent is not null and s.other_count = 1 then
          'Best set vs ' || (s.primary_opponent->>'displayName')
        else s.base_title
      end,
      'status', s.status,
      'myParticipantStatus', s.my_status,
      'startsAt', s.starts_at,
      'endsAt', s.ends_at,
      'timeLeftS', s.time_left_s,
      'timeLeftAmount', case
        when s.time_left_s >= 86400 then (s.time_left_s / 86400)
        when s.time_left_s >= 3600 then (s.time_left_s / 3600)
        else greatest(s.time_left_s / 60, 1)
      end,
      'timeLeftUnit', case
        when s.ends_at is null then null
        when s.time_left_s >= 86400 then 'day'
        when s.time_left_s >= 3600 then 'hour'
        when s.time_left_s > 0 then 'minute'
        else 'minute'
      end,
      'canDoPushUps', s.can_do_push_ups,
      'needsResponse', s.needs_response,
      'isMyTurn', s.in_action,
      'turnReason', case
        when s.needs_response then 'invite'
        when s.cta_type = 'play' then 'play'
        when s.status_key = 'behind' then 'behind'
        when s.status_key = 'start' then 'start'
        when s.status_key = 'contribute' then 'contribute'
        when s.status_key = 'streak_today' then 'streak_today'
        else null
      end,
      'ctaType', s.cta_type,
      'ctaLabel', case s.cta_type
        when 'play' then 'Play'
        when 'start_set' then 'Start a set'
        else null
      end,
      'statusKey', s.status_key,
      'statusLabel', case s.status_key
        when 'invited_you' then s.base_title
        when 'awaiting_result' then 'Ended · Results soon'
        when 'tied' then 'Tied'
        when 'you_lead' then 'You lead'
        when 'behind' then private.person_label(null, s.leader_display_name) || ' leads'
        when 'contribute' then coalesce(s.team_total, 0)::text || ' of ' || coalesce(s.team_target, s.target_reps, 0)::text
        when 'goal_done' then coalesce(s.team_total, 0)::text || ' of ' || coalesce(s.team_target, s.target_reps, 0)::text
        when 'streak_today' then
          'Day ' || (coalesce(s.days_survived, 0) + 1)::text || ' of ' ||
          coalesce(round(extract(epoch from (s.ends_at - s.starts_at)) / 86400)::int, 0)::text
        when 'goal_done_today' then
          'Day ' || (coalesce(s.days_survived, 0) + 1)::text || ' of ' ||
          coalesce(round(extract(epoch from (s.ends_at - s.starts_at)) / 86400)::int, 0)::text
        when 'play' then
          case when coalesce((
            select max(l.valid_reps) from public.challenge_standings_live l
             where l.challenge_id = s.id and l.user_id <> v_me and coalesce(l.attempts_used, 0) > 0
          ), 0) > 0
          then (
            select max(l.valid_reps)::text from public.challenge_standings_live l
             where l.challenge_id = s.id and l.user_id <> v_me and coalesce(l.attempts_used, 0) > 0
          ) || ' to beat'
          else null end
        when 'waiting_on' then
          'Waiting on ' || coalesce((s.primary_opponent->>'displayName'), 'others')
        else null
      end,
      'sortRank', case when s.in_action then 0 else 1 end,
      'myValidReps', s.my_reps,
      'leaderUserId', s.leader_user_id,
      'leaderDisplayName', s.leader_display_name,
      'leaderReps', s.leader_reps,
      'waitingOn', case when not s.in_action then
        (select coalesce(jsonb_agg(jsonb_build_object(
           'userId', cp.user_id,
           'displayName', private.person_label(pr.username, pr.display_name)
         )), '[]'::jsonb)
           from public.challenge_participants cp
           left join public.profiles pr on pr.id = cp.user_id
          where cp.challenge_id = s.id and cp.user_id <> v_me
            and cp.status in ('invited', 'accepted'))
      else '[]'::jsonb end,
      'people', s.people,
      'teamTotal', s.team_total,
      'teamTarget', coalesce(s.team_target, s.target_reps),
      'streakDay', case when s.kind = 'streak' then coalesce(s.days_survived, 0) + 1 else null end,
      'streakLength', case when s.kind = 'streak' then
        round(extract(epoch from (s.ends_at - s.starts_at)) / 86400)::int
      else null end,
      'progressFrac', case
        when s.kind = 'team' and coalesce(s.team_target, s.target_reps, 0) > 0 then
          least(1, coalesce(s.team_total, 0)::numeric / coalesce(s.team_target, s.target_reps))
        when s.kind = 'streak' and s.starts_at is not null and s.ends_at is not null then
          least(1, (coalesce(s.days_survived, 0) + 1)::numeric /
            nullif(round(extract(epoch from (s.ends_at - s.starts_at)) / 86400), 0))
        else null
      end,
      'primaryOpponentUserId', s.primary_opponent->>'userId',
      'primaryOpponentDisplayName', s.primary_opponent->>'displayName',
      'awaitingResult', s.awaiting_result,
      'durationDays', s.duration_days,
      'windowUnit', s.window_unit,
      'targetReps', s.target_reps
    ) order by case when s.in_action then 0 else 1 end,
              s.ends_at nulls last,
              s.created_at), '[]'::jsonb)
      from shaped s
  );
end $$;

revoke all on function public.my_open_challenges() from public, anon;
grant execute on function public.my_open_challenges() to authenticated;

-- -------------------------------------------------------------------------------------
-- Lifetime / period records. Declined invites are omitted from the stats.
-- -------------------------------------------------------------------------------------
create or replace view private.challenge_record_events
  with (security_invoker = true)
as
select
  p.user_id,
  b.id as challenge_id,
  b.kind,
  b.status as challenge_status,
  p.status as participant_status,
  case
    when p.status not in ('accepted', 'forfeited') then 'declined'
    when p.status = 'forfeited' then 'forfeit'
    when b.status = 'cancelled' then 'cancelled'
    when b.status = 'expired' then 'expired'
    when r.is_winner then 'win'
    when r.rank = 1 and coalesce(r.is_winner, false) = false then 'tie'
    when r.user_id is not null then 'loss'
    else 'expired'
  end as outcome,
  b.finished_at,
  b.starts_at,
  b.ends_at,
  r.is_winner,
  r.rank,
  r.valid_reps,
  r.team_total,
  r.team_target
from public.challenge_participants p
join public.challenges b on b.id = p.challenge_id
left join public.challenge_results r on r.challenge_id = b.id and r.user_id = p.user_id
where b.status in ('completed', 'cancelled', 'expired');

revoke all on private.challenge_record_events from public, anon, authenticated;

create or replace function public.my_challenge_record(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_zone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;
  select coalesce(time_zone, 'UTC') into v_zone from public.profiles where id = v_me;
  v_to := coalesce(p_to, now());
  v_from := coalesce(p_from, date_trunc('day', v_to at time zone v_zone) at time zone v_zone - interval '30 days');
  return (
    with ev as (
      select *
        from private.challenge_record_events e
       where e.user_id = v_me
         and e.outcome <> 'declined'
         and e.finished_at >= v_from and e.finished_at < v_to
    ), header as (
      select
        count(*) filter (where outcome = 'win') as wins,
        count(*) filter (where outcome = 'tie') as ties,
        count(*) filter (where outcome = 'loss') as losses,
        count(*) filter (where outcome = 'forfeit') as forfeits,
        count(*) filter (where outcome = 'cancelled') as cancelled,
        count(*) filter (where outcome = 'expired') as expired
      from ev
    ), partners as (
      select op.user_id,
             pr.username,
             pr.display_name,
             count(*) filter (where e.outcome = 'win') as wins,
             count(*) filter (where e.outcome = 'tie') as ties,
             count(*) filter (where e.outcome = 'loss') as losses,
             count(*) filter (where e.outcome = 'forfeit') as forfeits,
             max(e.finished_at) as last_finished_at,
             (array_agg(e.outcome order by e.finished_at desc))[1] as last_outcome
        from ev e
        join public.challenge_participants op
          on op.challenge_id = e.challenge_id and op.user_id <> v_me
         and op.status in ('accepted', 'forfeited')
        join public.profiles pr on pr.id = op.user_id
       where e.outcome in ('win', 'tie', 'loss', 'forfeit')
       group by op.user_id, pr.username, pr.display_name
    )
    select jsonb_build_object(
      'periodFrom', v_from,
      'periodTo', v_to,
      'wins', (select wins from header),
      'ties', (select ties from header),
      'losses', (select losses from header),
      'forfeits', (select forfeits from header),
      'cancelled', (select cancelled from header),
      'expired', (select expired from header),
      'declined', 0,
      'friends', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', p.user_id,
          'username', p.username,
          'displayName', coalesce(nullif(trim(p.display_name), ''), p.username),
          'wins', p.wins,
          'ties', p.ties,
          'losses', p.losses,
          'forfeits', p.forfeits,
          'lastFinishedAt', p.last_finished_at,
          'lastOutcome', p.last_outcome,
          'sortRank', p.sort_rank
        ) order by p.sort_rank)
        from (
          select *, row_number() over (order by last_finished_at desc) as sort_rank
          from partners
        ) p
      ), '[]'::jsonb),
      'otherEvents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'challengeId', e.challenge_id,
          'kind', e.kind,
          'title', private.challenge_title(e.challenge_id),
          'outcome', e.outcome,
          'outcomeLabel', initcap(e.outcome),
          'finishedAt', e.finished_at,
          'sortRank', e.sort_rank
        ) order by e.sort_rank)
        from (
          select ev.*, row_number() over (order by ev.finished_at desc) as sort_rank
          from ev
         where ev.outcome in ('cancelled', 'expired')
        ) e
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.my_challenge_record(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_challenge_record(timestamptz, timestamptz) to authenticated;

drop function if exists public.friend_challenge_record(uuid);

create or replace function public.friend_challenge_record(p_user uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me uuid := private.me();
  v_zone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_user is distinct from v_me and not public.are_friends(v_me, p_user) then
    raise exception 'not friends';
  end if;
  select coalesce(time_zone, 'UTC') into v_zone from public.profiles where id = v_me;
  v_to := coalesce(p_to, now());
  v_from := coalesce(p_from, date_trunc('day', v_to at time zone v_zone) at time zone v_zone - interval '30 days');
  return (
    with ev as (
      select e.*
        from private.challenge_record_events e
       where e.user_id = v_me
         and e.outcome <> 'declined'
         and e.finished_at >= v_from and e.finished_at < v_to
         and exists (
           select 1 from public.challenge_participants o
            where o.challenge_id = e.challenge_id and o.user_id = p_user
              and o.status in ('accepted', 'forfeited')
         )
    )
    select jsonb_build_object(
      'userId', p_user,
      'periodFrom', v_from,
      'periodTo', v_to,
      'wins', (select count(*) from ev where outcome = 'win'),
      'ties', (select count(*) from ev where outcome = 'tie'),
      'losses', (select count(*) from ev where outcome = 'loss'),
      'forfeits', (select count(*) from ev where outcome = 'forfeit'),
      'cancelled', (select count(*) from ev where outcome = 'cancelled'),
      'expired', (select count(*) from ev where outcome = 'expired'),
      'played', (select count(*) from ev where outcome in ('win', 'tie', 'loss')),
      'won', (select count(*) from ev where outcome = 'win'),
      'drawn', (select count(*) from ev where outcome = 'tie'),
      'lost', (select count(*) from ev where outcome = 'loss'),
      'open', '[]'::jsonb,
      'finished', coalesce((
        select jsonb_agg(jsonb_build_object(
          'challengeId', e.challenge_id,
          'kind', e.kind,
          'title', private.challenge_title(e.challenge_id),
          'outcome', e.outcome,
          'outcomeLabel', case e.outcome
            when 'win' then 'Won'
            when 'tie' then 'Tied'
            when 'loss' then 'Lost'
            when 'forfeit' then 'Forfeit'
            else initcap(e.outcome)
          end,
          'finishedAt', e.finished_at,
          'myReps', e.valid_reps,
          'theirReps', e.their_reps,
          'sortRank', e.sort_rank
        ) order by e.sort_rank)
        from (
          select ev.*, r.valid_reps as their_reps,
                 row_number() over (order by ev.finished_at desc) as sort_rank
            from ev
            left join public.challenge_results r on r.challenge_id = ev.challenge_id and r.user_id = p_user
        ) e
      ), '[]'::jsonb),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'challengeId', e.challenge_id,
          'finishedAt', e.finished_at,
          'kind', e.kind,
          'windowUnit', b.window_unit,
          'metric', b.metric,
          'durationS', b.duration_s,
          'players', (select count(*) from public.challenge_results c where c.challenge_id = e.challenge_id),
          'me', jsonb_build_object('rank', me.rank, 'isWinner', me.is_winner, 'validReps', me.valid_reps, 'metricValue', me.metric_value),
          'them', jsonb_build_object('rank', th.rank, 'isWinner', th.is_winner, 'validReps', th.valid_reps, 'metricValue', th.metric_value)
        ) order by e.finished_at desc)
        from ev e
        join public.challenges b on b.id = e.challenge_id
        left join public.challenge_results me on me.challenge_id = e.challenge_id and me.user_id = v_me
        left join public.challenge_results th on th.challenge_id = e.challenge_id and th.user_id = p_user
       where e.outcome in ('win', 'tie', 'loss')
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.friend_challenge_record(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.friend_challenge_record(uuid, timestamptz, timestamptz) to authenticated;
