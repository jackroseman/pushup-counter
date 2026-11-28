-- Period list for challenge records, plus result and layout fields on my_challenges
-- so the client does not decide whose turn it is, how it ended, or whether to show
-- a head-to-head card. All-time uses a concrete early bound so p_from stays usable.

create or replace function public.challenge_record_periods()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_zone text;
  v_now timestamptz := now();
  v_today date;
  v_start_of_today timestamptz;
  v_start_of_month timestamptz;
  v_start_of_year timestamptz;
  v_start_of_last_month timestamptz;
  v_start_of_last_year timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select coalesce(nullif(time_zone, ''), 'UTC') into v_zone
    from public.profiles where id = auth.uid();
  if v_zone is null then
    v_zone := 'UTC';
  end if;
  v_today := (v_now at time zone v_zone)::date;
  v_start_of_today := v_today::timestamp at time zone v_zone;
  v_start_of_month := date_trunc('month', v_today)::timestamp at time zone v_zone;
  v_start_of_year := date_trunc('year', v_today)::timestamp at time zone v_zone;
  v_start_of_last_month := (date_trunc('month', v_today) - interval '1 month')::timestamp at time zone v_zone;
  v_start_of_last_year := (date_trunc('year', v_today) - interval '1 year')::timestamp at time zone v_zone;
  return jsonb_build_array(
    jsonb_build_object('key', 'last_30_days', 'label', 'Last 30 days',
      'from', v_start_of_today - interval '30 days', 'to', v_now, 'isDefault', true),
    jsonb_build_object('key', 'last_month', 'label', 'Last month',
      'from', v_start_of_last_month, 'to', v_start_of_month, 'isDefault', false),
    jsonb_build_object('key', 'this_month', 'label', 'This month',
      'from', v_start_of_month, 'to', v_now, 'isDefault', false),
    jsonb_build_object('key', 'last_3_months', 'label', 'Last 3 months',
      'from', v_start_of_today - interval '3 months', 'to', v_now, 'isDefault', false),
    jsonb_build_object('key', 'this_year', 'label', 'This year',
      'from', v_start_of_year, 'to', v_now, 'isDefault', false),
    jsonb_build_object('key', 'last_year', 'label', 'Last year',
      'from', v_start_of_last_year, 'to', v_start_of_year, 'isDefault', false),
    jsonb_build_object('key', 'all_time', 'label', 'All time',
      'from', timestamptz '1970-01-01+00', 'to', v_now, 'isDefault', false)
  );
end;
$$;

revoke all on function public.challenge_record_periods() from public, anon;
grant execute on function public.challenge_record_periods() to authenticated;

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
      'needsResponse', exists (
        select 1 from public.challenge_participants p
         where p.challenge_id = b.id and p.user_id = (select auth.uid())
           and p.status = 'invited' and b.status in ('pending', 'active')
      ),
      'detailLayout', case
        when b.kind = 'team' then 'team'
        when b.kind in ('best_set', 'total')
         and (select count(*) from public.challenge_participants p
               where p.challenge_id = b.id
                 and p.status in ('accepted', 'invited', 'forfeited')) = 2
        then 'head_to_head'
        else 'standings'
      end,
      'myOutcome', case
        when b.status in ('pending', 'active') then null
        when (select p.status from public.challenge_participants p
               where p.challenge_id = b.id and p.user_id = (select auth.uid())) = 'forfeited' then 'forfeit'
        when b.status = 'cancelled' then 'cancelled'
        when b.status = 'expired' then 'expired'
        when (select r.is_winner from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'win'
        when (select r.rank = 1 and coalesce(r.is_winner, false) = false from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'tie'
        when exists (select 1 from public.challenge_results r
                      where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'loss'
        else 'expired'
      end,
      'myOutcomeLabel', case
        when b.status in ('pending', 'active') then null
        when (select p.status from public.challenge_participants p
               where p.challenge_id = b.id and p.user_id = (select auth.uid())) = 'forfeited' then 'Forfeit'
        when b.status = 'cancelled' then 'Cancelled'
        when b.status = 'expired' then 'Expired'
        when (select r.is_winner from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'Won'
        when (select r.rank = 1 and coalesce(r.is_winner, false) = false from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'Tied'
        when exists (select 1 from public.challenge_results r
                      where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'Lost'
        else 'Expired'
      end,
      'resultTitle', case
        when b.status in ('pending', 'active') then null
        when (select p.status from public.challenge_participants p
               where p.challenge_id = b.id and p.user_id = (select auth.uid())) = 'forfeited' then 'Forfeit'
        when b.status = 'cancelled' then 'Cancelled'
        when b.status = 'expired' then 'Expired'
        when b.kind = 'team' and exists (
          select 1 from public.challenge_results r
           where r.challenge_id = b.id and r.user_id = (select auth.uid()) and r.is_winner
        ) then 'Goal reached'
        when b.kind = 'team' and exists (
          select 1 from public.challenge_results r
           where r.challenge_id = b.id and r.user_id = (select auth.uid())
        ) then 'Missed the goal'
        when (select r.is_winner from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'You won'
        when (select r.rank = 1 and coalesce(r.is_winner, false) = false from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'Tied'
        when exists (select 1 from public.challenge_results r
                      where r.challenge_id = b.id and r.is_winner and r.user_id is distinct from (select auth.uid()))
        then (
          select coalesce(nullif(pr.display_name, ''), pr.username, 'They') || ' won'
            from public.challenge_results r
            join public.profiles pr on pr.id = r.user_id
           where r.challenge_id = b.id and r.is_winner
           limit 1
        )
        when exists (select 1 from public.challenge_results r
                      where r.challenge_id = b.id and r.user_id = (select auth.uid())) then 'Finished'
        else 'Expired'
      end,
      'resultCrowned', case
        when b.status <> 'completed' then false
        when (select p.status from public.challenge_participants p
               where p.challenge_id = b.id and p.user_id = (select auth.uid())) = 'forfeited' then false
        when (select r.is_winner from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then true
        when exists (select 1 from public.challenge_results r
                      where r.challenge_id = b.id and r.is_winner) then true
        else false
      end,
      'resultShowcaseUserId', case
        when b.status in ('pending', 'active') then null
        when (select r.is_winner from public.challenge_results r
               where r.challenge_id = b.id and r.user_id = (select auth.uid())) then (select auth.uid())
        when exists (select 1 from public.challenge_results r
                      where r.challenge_id = b.id and r.is_winner)
        then (select r.user_id from public.challenge_results r
               where r.challenge_id = b.id and r.is_winner limit 1)
        else (select auth.uid())
      end,
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
  if p_user is distinct from v_me and not private.are_friends(v_me, p_user) then
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
      'bestSet', (
        select max(r.valid_reps)
          from ev e
          join public.challenge_results r on r.challenge_id = e.challenge_id and r.user_id = p_user
         where e.kind = 'best_set' and r.valid_reps is not null
      ),
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
