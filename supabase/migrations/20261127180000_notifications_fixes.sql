-- Notification fixes (docs/notifications audit, implemented in app/DB only):
-- * Window set updates require the actor to be a participant, and only fire on a
--   lead change, passing the recipient, a first best-set attempt, or a milestone.
-- * Quiet hours delay only nudges and reminders.
-- * Outbox stores sent title/body/data; unsent rows for users with no token expire in 2 hours.
-- * submit_set drains notify after the reps are stored.

alter table private.notification_outbox
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists data jsonb;

-- Kinds that wait for quiet hours. Everything else goes out when it happens.
create or replace function private.notification_is_quiet(p_kind text)
returns boolean
language sql
immutable
as $fn$
  select p_kind in (
    'daily_nudge', 'weekly_recap', 'pass_ping',
    'challenge_reminder', 'challenge_reminder_half'
  );
$fn$;

create or replace function private.has_active_push_token(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.push_tokens t
      join public.devices d on d.id = t.device_id
     where d.user_id = p_user
       and t.disabled_at is null
  );
$fn$;

create or replace function private.expire_notifications()
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- No token: drop after 2 hours so a late permission grant does not deliver a stale event.
  update private.notification_outbox o
     set failed_at = now(),
         leased_until = null
   where o.sent_at is null
     and o.failed_at is null
     and o.created_at <= now() - interval '2 hours'
     and not private.has_active_push_token(o.user_id);

  update private.notification_outbox o
     set failed_at = now(),
         leased_until = null
   where o.sent_at is null
     and o.failed_at is null
     and o.created_at <= now() - interval '1 day'
     and (o.not_before is null or o.not_before <= now());

  delete from private.notification_outbox o where o.created_at < now() - interval '30 days';
end
$fn$;

create or replace function private.has_unsent_notifications()
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select exists (
    select 1 from private.notification_outbox o
     where o.sent_at is null
       and o.failed_at is null
       and (o.not_before is null or o.not_before <= now())
       and (
         o.created_at <= now() - interval '1 day'
         or (o.created_at <= now() - interval '2 hours'
             and not private.has_active_push_token(o.user_id))
         or ((o.leased_until is null or o.leased_until <= now())
             and (not private.notification_is_quiet(o.kind)
                  or not coalesce(private.in_quiet(o.user_id, now()), false)))
       )
  );
$fn$;

create or replace function public.lease_notifications(p_limit integer default 200)
returns table(id bigint, user_id uuid, kind text, challenge_id uuid, facts jsonb)
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  perform private.expire_notifications();
  return query
    with picked as (
      select o.id from private.notification_outbox o
       where o.sent_at is null
         and o.failed_at is null
         and (o.leased_until is null or o.leased_until <= now())
         and (o.not_before is null or o.not_before <= now())
         and (not private.notification_is_quiet(o.kind)
              or not coalesce(private.in_quiet(o.user_id, now()), false))
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
end
$fn$;

create or replace function public.claim_notifications(p_limit integer default 200)
returns table(id bigint, user_id uuid, kind text, challenge_id uuid, facts jsonb)
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  perform private.expire_notifications();
  return query
    with picked as (
      select o.id from private.notification_outbox o
       where o.sent_at is null
         and o.failed_at is null
         and o.kind in (
           'friend_request', 'friend_accepted', 'friend_joined', 'challenge_invite',
           'invite_accepted', 'invite_declined', 'set_submitted', 'challenge_result',
           'challenge_expired', 'challenge_cancelled', 'challenge_reminder', 'challenge_reminder_half'
         )
         and (o.not_before is null or o.not_before <= now())
         and (not private.notification_is_quiet(o.kind)
              or not coalesce(private.in_quiet(o.user_id, now()), false))
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
end
$fn$;

drop function if exists public.settle_notifications(bigint[], bigint[]);

create or replace function public.settle_notifications(
  p_sent bigint[],
  p_failed bigint[],
  p_contents jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  update private.notification_outbox o
     set title = c.title,
         body = c.body,
         data = c.data,
         sent_at = now(),
         leased_until = null
    from jsonb_to_recordset(coalesce(p_contents, '[]'::jsonb))
         as c(id bigint, title text, body text, data jsonb)
   where o.id = c.id
     and o.id = any(coalesce(p_sent, '{}'::bigint[]))
     and o.sent_at is null
     and o.failed_at is null;

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
end
$fn$;

revoke all on function public.settle_notifications(bigint[], bigint[], jsonb) from public, anon, authenticated;
grant execute on function public.settle_notifications(bigint[], bigint[], jsonb) to service_role;

create or replace function private.standing_score(
  p_kind public.challenge_kind,
  p_metric public.challenge_metric,
  p_valid_reps integer,
  p_metric_value numeric,
  p_days integer
) returns numeric
language sql
immutable
as $fn$
  select case
    when p_kind = 'streak' then coalesce(p_days, 0)::numeric
    when p_kind = 'best_set' and p_metric is not null and p_metric is distinct from 'rep_count'
      then coalesce(p_metric_value, 0)
    else coalesce(p_valid_reps, 0)::numeric
  end;
$fn$;

-- A challenge update is queued only when the actor is a participant and this set
-- took the lead, tied for first, passed the recipient, posted a first best-set
-- attempt, or crossed a milestone (25, 50, 100, 250, 500, 1000, or 25/50/75/100%
-- of a team target). An uncontested opening score below a milestone does not notify.
-- Milestones are throttled to one push per actor/recipient/challenge per 30 minutes;
-- lead changes, passing someone, and a first best-set attempt are not.
create or replace function private.queue_set_submitted(p_set uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  s public.sets;
  counted integer;
  v_grace interval;
  b record;
  rec record;
  actor_after numeric;
  actor_before numeric;
  recip_score numeric;
  others_have_score boolean;
  unique_first_after boolean;
  unique_first_before boolean;
  rank_before integer;
  took_lead boolean;
  tied_lead boolean;
  passed boolean;
  hit_milestone boolean;
  first_attempt boolean;
  team_after integer;
  team_before integer;
  team_target integer;
  bypass boolean;
  recent boolean;
  v_inserted integer;
  v_queued boolean := false;
begin
  select * into s from public.sets where id = p_set;
  if not found then return; end if;

  select coalesce(sum(m.good_or_better_reps), 0) into counted
    from public.set_metrics m where m.set_id = s.id;
  if counted <= 0 then return; end if;

  v_grace := make_interval(secs => least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400));

  for b in
    select distinct ch.id, ch.kind, ch.metric, ch.target_reps, ch.starts_at, ch.ends_at
      from public.challenges ch
      join public.challenge_participants ap
        on ap.challenge_id = ch.id
       and ap.user_id = s.user_id
       and ap.status in ('invited', 'accepted')
       and (ap.left_at is null or s.started_at < ap.left_at)
     where ch.status in ('pending', 'active')
       and (
         (ch.kind in ('total', 'streak', 'team')
          and ch.starts_at is not null and ch.ends_at is not null
          and s.started_at >= ch.starts_at
          and s.started_at < ch.ends_at
          and s.received_at <= ch.ends_at + v_grace)
         or ch.id = s.challenge_id
       )
  loop
    select private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived),
           l.team_total, l.team_target
      into actor_after, team_after, team_target
      from public.challenge_standings_live l
     where l.challenge_id = b.id and l.user_id = s.user_id;

    if actor_after is null then
      actor_after := counted;
      team_after := counted;
      team_target := b.target_reps;
    end if;

    first_attempt := false;
    if b.kind = 'best_set' then
      first_attempt := not exists (
        select 1 from public.sets st
         where st.challenge_id = b.id and st.user_id = s.user_id and st.id is distinct from s.id
      );
      if first_attempt then
        actor_before := 0;
      else
        if exists (
          select 1 from public.challenge_standings_live l
           where l.challenge_id = b.id and l.user_id = s.user_id
             and l.best_set_id is distinct from s.id
        ) then
          continue;
        end if;
        select coalesce(max(sm.good_or_better_reps), 0) into actor_before
          from public.sets st
          join public.set_metrics sm on sm.set_id = st.id
         where st.challenge_id = b.id and st.user_id = s.user_id and st.id is distinct from s.id;
      end if;
    elsif b.kind = 'streak' then
      actor_before := actor_after
        - case when exists (
            select 1 from public.sets st
            join public.set_metrics sm on sm.set_id = st.id
           where st.user_id = s.user_id
             and st.id is distinct from s.id
             and sm.good_or_better_reps > 0
             and b.starts_at is not null and b.ends_at is not null
             and st.started_at >= b.starts_at and st.started_at < b.ends_at
             and ((st.started_at at time zone 'UTC')::date = (s.started_at at time zone 'UTC')::date)
          ) then 0 else 1 end;
      if actor_before < 0 then actor_before := 0; end if;
    else
      actor_before := greatest(actor_after - counted, 0);
    end if;

    team_before := greatest(coalesce(team_after, 0) - counted, 0);

    select exists (
      select 1
        from public.challenge_participants p
        left join public.challenge_standings_live l
          on l.challenge_id = p.challenge_id and l.user_id = p.user_id
       where p.challenge_id = b.id
         and p.user_id is distinct from s.user_id
         and p.status in ('invited', 'accepted')
         and (p.left_at is null or s.started_at < p.left_at)
         and private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived) > 0
    ) into others_have_score;

    select 1 + count(*) into rank_before
      from public.challenge_participants p
      left join public.challenge_standings_live l
        on l.challenge_id = p.challenge_id and l.user_id = p.user_id
     where p.challenge_id = b.id
       and p.user_id is distinct from s.user_id
       and p.status in ('invited', 'accepted')
       and (p.left_at is null or s.started_at < p.left_at)
       and private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived) > actor_before;

    select count(*) = 0 into unique_first_after
      from public.challenge_participants p
      left join public.challenge_standings_live l
        on l.challenge_id = p.challenge_id and l.user_id = p.user_id
     where p.challenge_id = b.id
       and p.user_id is distinct from s.user_id
       and p.status in ('invited', 'accepted')
       and (p.left_at is null or s.started_at < p.left_at)
       and private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived) >= actor_after
       and actor_after > 0;

    unique_first_before := actor_before > 0 and not exists (
      select 1
        from public.challenge_participants p
        left join public.challenge_standings_live l
          on l.challenge_id = p.challenge_id and l.user_id = p.user_id
       where p.challenge_id = b.id
         and p.user_id is distinct from s.user_id
         and p.status in ('invited', 'accepted')
         and (p.left_at is null or s.started_at < p.left_at)
         and private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived) >= actor_before
    );

    -- Taking an uncontested lead (nobody else has a score) only notifies at a milestone,
    -- except a first best-set attempt, which always tells the other players.
    took_lead := unique_first_after and not unique_first_before and others_have_score;
    tied_lead := actor_after > 0 and rank_before > 1 and not unique_first_after
      and exists (
        select 1
          from public.challenge_participants p
          left join public.challenge_standings_live l
            on l.challenge_id = p.challenge_id and l.user_id = p.user_id
         where p.challenge_id = b.id
           and p.user_id is distinct from s.user_id
           and p.status in ('invited', 'accepted')
           and (p.left_at is null or s.started_at < p.left_at)
           and private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived) = actor_after
      );

    hit_milestone := exists (
      select 1 from unnest(array[25, 50, 100, 250, 500, 1000]) m
       where actor_before < m and actor_after >= m
    ) or (
      b.kind = 'team' and team_target is not null and team_target > 0 and exists (
        select 1 from unnest(array[25, 50, 75, 100]) pct
         where team_before * 100 / team_target < pct
           and coalesce(team_after, 0) * 100 / team_target >= pct
      )
    ) or (
      b.kind = 'team' and exists (
        select 1 from unnest(array[25, 50, 100, 250, 500, 1000]) m
         where team_before < m and coalesce(team_after, 0) >= m
      )
    );

    for rec in
      select p.user_id
        from public.challenge_participants p
       where p.challenge_id = b.id
         and p.status in ('invited', 'accepted')
         and p.left_at is null
         and p.user_id is distinct from s.user_id
    loop
      select private.standing_score(b.kind, b.metric, l.valid_reps, l.metric_value, l.days_survived)
        into recip_score
        from public.challenge_standings_live l
       where l.challenge_id = b.id and l.user_id = rec.user_id;
      recip_score := coalesce(recip_score, 0);

      -- Passing someone who has 0 is the uncontested opening; do not treat it as a pass.
      passed := actor_after > recip_score and actor_before <= recip_score and recip_score > 0;
      bypass := first_attempt or took_lead or tied_lead or passed;
      if not bypass and not hit_milestone then
        continue;
      end if;

      if not bypass then
        select exists (
          select 1 from private.notification_outbox o
           where o.kind = 'set_submitted'
             and o.user_id = rec.user_id
             and o.challenge_id = b.id
             and o.actor_id = s.user_id
             and o.failed_at is null
             and o.created_at > now() - interval '30 minutes'
        ) into recent;
        if recent then continue; end if;
      end if;

      insert into private.notification_outbox (kind, user_id, challenge_id, actor_id, dedupe_key, not_before)
      values ('set_submitted', rec.user_id, b.id, s.user_id, 'set:' || p_set::text, now())
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted > 0 then v_queued := true; end if;
    end loop;
  end loop;

  if v_queued then
    begin
      perform private.wake_notify();
    exception when others then
      null;
    end;
  end if;
end
$fn$;

revoke all on function private.queue_set_submitted(uuid) from public, anon, authenticated;
grant execute on function private.queue_set_submitted(uuid) to authenticated, service_role;
revoke all on function private.standing_score(public.challenge_kind, public.challenge_metric, integer, numeric, integer) from public, anon, authenticated;
revoke all on function private.notification_is_quiet(text) from public, anon, authenticated;
revoke all on function private.has_active_push_token(uuid) from public, anon, authenticated;

drop trigger if exists notify_window_set on public.reps;
drop trigger if exists notify_set on public.sets;

create or replace function private.tg_notify_set()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.challenge_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.challenge_id is not distinct from old.challenge_id then
    return null;
  end if;
  perform private.queue_set_submitted(new.id);
  return null;
end
$fn$;

-- Linking a finished set attaches challenge_id after the reps already exist.
create trigger notify_set
  after update of challenge_id on public.sets
  for each row
  when (new.challenge_id is not null and new.challenge_id is distinct from old.challenge_id)
  execute function private.tg_notify_set();

create or replace function public.submit_set(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_user   uuid := case when current_user = 'service_role' then (p->>'userId')::uuid
                        else (select auth.uid()) end;
  v_start  timestamptz := to_timestamp((p->>'startedAt')::double precision / 1000);
  v_battle uuid := (p->>'challengeId')::uuid;
  v_link   boolean := coalesce((p->>'linkFinishedSet')::boolean, false);
  v_end    text := coalesce(nullif(btrim(p->>'endReason'), ''), 'user');
  v_set    uuid;
  existing public.sets;
  attempt  integer;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if v_battle is not null and current_user <> 'service_role' then
    raise exception 'battle sets go through submit-set';
  end if;

  if exists (
    select 1 from public.deleted_sets d
    where d.user_id = v_user and d.client_set_id = p->>'id'
  ) then
    delete from public.sets
     where user_id = v_user and client_set_id = p->>'id' and challenge_id is null;
    raise exception 'set was deleted' using errcode = '22023';
  end if;

  for attempt in 1..2 loop
    select * into existing from public.sets where user_id = v_user and client_set_id = p->>'id';
    if found then
      if v_battle is null or existing.challenge_id is not distinct from v_battle then
        return existing.id;
      end if;
      if existing.challenge_id is not null then raise exception 'set already in a battle'; end if;
      if not v_link then raise exception 'set already uploaded and was not linked'; end if;
      update public.sets
         set challenge_id = v_battle
       where id = existing.id and user_id = v_user and challenge_id is null
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
      insert into public.sets (user_id, client_set_id, challenge_id, device_id, detector_config_id,
          data_version, app_version, update_id, started_at, ended_at, calibrated_top_m,
          calibration_samples, depth_tracking, proximity_available, clock_offset_ms, timer_duration_s,
          recorded_time_zone, end_reason)
      values (v_user, p->>'id', v_battle, (p->>'deviceId')::uuid,
          case when p ? 'detectorConfig' then public.ensure_detector_config(p->'detectorConfig') end,
          coalesce((p->>'version')::smallint, 1), p->>'appVersion', p->>'updateId',
          v_start, to_timestamp((p->>'endedAt')::double precision / 1000),
          (p->>'calibratedTopDistance')::real, (p->>'calibrationSamples')::smallint,
          coalesce((p->>'depthTracking')::boolean, true), (p->>'proximityAvailable')::boolean,
          (p->>'clockOffsetMs')::integer,
          (p->>'timerDurationS')::integer,
          nullif(btrim(p->>'timeZone'), ''),
          v_end)
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
      perform private.queue_set_submitted(v_set);
      return v_set;
    exception when unique_violation then
      if attempt = 2 then raise; end if;
    end;
  end loop;
  raise exception 'could not save set';
end $$;

create or replace function private.notification_facts(p_kind text, p_user uuid, p_battle uuid, p_actor uuid, p_dedupe text default ''::text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
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
                        'creatorName', (select display_name from public.profiles where id = b.created_by),
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
$fn$;
