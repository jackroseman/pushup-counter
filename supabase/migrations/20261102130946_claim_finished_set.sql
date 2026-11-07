-- Use a just-finished solo set as the creator's attempt when challenging a friend.
--
-- Battle sets still arrive only through submit_set() as the service role (the submit-set
-- Edge Function). If that set was already uploaded as a solo row (battle_id null), a
-- retry with linkFinishedSet links it instead of returning the old id and leaving the
-- battle empty. Clients still have no UPDATE grant; the BEFORE UPDATE trigger applies
-- the same battle rules as an insert, plus the claim rules below.
--
-- Claim rules (linkFinishedSet, or any update that sets battle_id):
--   * the caller owns the set (submit_set filters on user id)
--   * battle_id is null (not already in a battle)
--   * ended_at is within claim_set_max_age_s of now() (device clock, 2 min future slack)
--   * data version >= 2 and a detector config, so min_quality can be applied at query time
--   * attempts_allowed / open battle / participant checks (unchanged; multi-day is unlimited)
--   * timed battles: the set's stored timer_duration_s equals the battle's duration_s
--   * live battles cannot claim a finished set
-- Shallow reps still do not count: battle_entries keeps filtering on min_quality.

-- Raw fact: the timer the set was recorded against. Null = untimed. Not a derived metric.
alter table public.sets
  add column timer_duration_s integer,
  add constraint sets_timer_duration_s_check
    check (timer_duration_s is null or timer_duration_s between 30 and 600);

comment on column public.sets.timer_duration_s is
  'Timer the set was recorded against, in seconds. Null means the set was untimed.';

-- Keep any tuned values; only fill keys that are missing.
update public.app_settings
set value = value || jsonb_build_object(
      'claim_set_max_age_s', coalesce(value->'claim_set_max_age_s', '1800'::jsonb),
      'multi_day_window_days', coalesce(value->'multi_day_window_days', '7'::jsonb),
      'multi_day_window_options_days', coalesce(value->'multi_day_window_options_days', '[1,7,14]'::jsonb)
    ),
    description = 'Async battles: deadlines, timed presets, attempts, max-reps auto-end, '
      || 'claim_set_max_age_s (how recently a solo set must have ended to be used as the creator''s attempt), '
      || 'and multi-day window length in days.'
where key = 'async_battle_defaults';

-- Recency, scoreability, timed-timer match, and no live claims.
-- The open-battle / attempts / participant checks stay in tg_set_battle_guard.
create or replace function private.assert_finished_set_claim(
  p_ended_at timestamptz,
  p_timer_s integer,
  p_data_version integer,
  p_has_config boolean,
  p_battle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.battles;
  d jsonb := coalesce(public.setting('async_battle_defaults'), '{}'::jsonb);
  v_age integer := (d->>'claim_set_max_age_s')::integer;
begin
  if v_age is null or v_age < 60 or v_age > 86400 then v_age := 1800; end if;
  select * into b from public.battles where id = p_battle_id;
  if not found then raise exception 'battle not found'; end if;
  if b.mode = 'live' then raise exception 'live battles cannot use a finished set'; end if;
  if p_data_version < 2 or not p_has_config then
    raise exception 'set cannot be scored for this battle';
  end if;
  if p_ended_at < now() - make_interval(secs => v_age) or p_ended_at > now() + interval '2 minutes' then
    raise exception 'set is not recent enough to use';
  end if;
  if b.format = 'timed' and p_timer_s is distinct from b.duration_s then
    raise exception 'timed battle duration must match the set timer';
  end if;
end $$;

revoke all on function private.assert_finished_set_claim(timestamptz, integer, integer, boolean, uuid)
  from public, anon, authenticated;
grant execute on function private.assert_finished_set_claim(timestamptz, integer, integer, boolean, uuid)
  to service_role;

-- Inserts: unchanged battle rules. Updates that set battle_id: those rules, plus the claim.
create or replace function public.tg_set_battle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.battles; p public.battle_participants; n int; claiming boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.battle_id is not distinct from old.battle_id then return new; end if;
    if old.battle_id is not null then raise exception 'set already in a battle'; end if;
    if new.battle_id is null then raise exception 'a battle set cannot be detached'; end if;
    claiming := true;
  end if;

  if new.battle_id is null then return new; end if;

  if claiming then
    perform private.assert_finished_set_claim(
      new.ended_at, new.timer_duration_s, new.data_version::integer, new.detector_config_id is not null, new.battle_id);
  end if;

  select * into b from public.battles where id = new.battle_id;
  select * into p from public.battle_participants where battle_id = new.battle_id and user_id = new.user_id;
  if p.status is distinct from 'accepted' then raise exception 'not an accepted participant'; end if;
  if not (b.status = 'active' or (b.status = 'pending' and b.mode = 'async' and new.user_id = b.created_by)) then
    raise exception 'battle not open for sets';
  end if;
  if b.format <> 'multi_day' then
    select count(*) into n from public.sets where battle_id = b.id and user_id = new.user_id;
    if n >= b.attempts_allowed then raise exception 'no attempts left'; end if;
  end if;
  if b.ends_at is not null and new.received_at > b.ends_at + interval '5 minutes' then
    raise exception 'battle deadline passed';
  end if;
  if b.mode = 'live' and (b.starts_at is null
       or new.received_at > b.starts_at + make_interval(secs => coalesce(b.duration_s, 600)) + interval '5 minutes') then
    raise exception 'live battle window closed';
  end if;
  return new;
end $$;

drop trigger if exists set_battle_guard on public.sets;
create trigger set_battle_guard before insert or update of battle_id on public.sets
  for each row execute function public.tg_set_battle_guard();

-- Tell opponents when a solo set is linked, the same as a freshly inserted battle set.
create or replace function private.tg_notify_set()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.battle_id is null or new.battle_id is not distinct from old.battle_id) then
    return null;
  end if;
  if new.battle_id is null then return null; end if;
  perform private.enqueue('set_submitted',
    array(select p.user_id from public.battle_participants p
           where p.battle_id = new.battle_id and p.status in ('invited', 'accepted')),
    new.battle_id, new.user_id);
  return null;
end $$;

drop trigger if exists notify_set on public.sets;
create trigger notify_set after insert or update of battle_id on public.sets
  for each row execute function private.tg_notify_set();

-- Same upload as before. A battle id on a solo row links that row when linkFinishedSet
-- is true (service role only). A matching battle id is an idempotent retry.
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
          calibration_samples, depth_tracking, proximity_available, clock_offset_ms, timer_duration_s)
      values (v_user, p->>'id', v_battle, (p->>'deviceId')::uuid,
          case when p ? 'detectorConfig' then public.ensure_detector_config(p->'detectorConfig') end,
          coalesce((p->>'version')::smallint, 1), p->>'appVersion', p->>'updateId',
          v_start, to_timestamp((p->>'endedAt')::double precision / 1000),
          (p->>'calibratedTopDistance')::real, (p->>'calibrationSamples')::smallint,
          coalesce((p->>'depthTracking')::boolean, true), (p->>'proximityAvailable')::boolean,
          (p->>'clockOffsetMs')::integer,
          (p->>'timerDurationS')::integer)
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

-- Async create: max_reps, timed, and (from a finished set) multi_day. Live stays rejected.
-- Multi-day window length comes from async_battle_defaults, same as the other presets.
create or replace function public.create_battle(p jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_me       uuid := private.me();
  d          jsonb := coalesce(public.setting('async_battle_defaults'), '{}');
  v_format   public.battle_format;
  v_metric   public.battle_metric := coalesce(p->>'metric', 'rep_count')::public.battle_metric;
  v_duration integer;
  v_hours    numeric := coalesce((p->>'deadlineHours')::numeric, (d->>'deadline_hours')::numeric, 24);
  v_window   integer;
  v_max      integer := coalesce((p->>'maxParticipants')::integer, (public.setting('async_max_participants'))::integer, 8);
  v_friends  uuid[] := coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(p->'friendIds', '[]')) x), '{}');
  v_link     boolean := coalesce((p->>'inviteLink')::boolean, false);
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_id       uuid;
  v_token    text;
begin
  if coalesce(p->>'mode', 'async') <> 'async' then raise exception 'live battles are not available yet'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  v_format := (p->>'format')::public.battle_format;
  if v_format is null then raise exception 'format must be max_reps, timed, or multi_day'; end if;
  if v_format = 'timed' then
    v_duration := (p->>'durationS')::integer;
    if v_duration is null or not (coalesce(d->'timed_durations_s', '[60,120]') @> to_jsonb(v_duration)) then
      raise exception 'timed battles last % seconds', coalesce(d->'timed_durations_s', '[60,120]');
    end if;
    v_metric := 'rep_count';
  end if;
  -- The just-finished set usually ends a little before starts_at. It still counts:
  -- battle_entries pools every set with this battle_id and does not drop pre-window sets.
  if v_format = 'multi_day' then
    v_window := coalesce((p->>'windowDays')::integer, (d->>'multi_day_window_days')::integer, 7);
    if v_window is null or not (coalesce(d->'multi_day_window_options_days', '[1,7,14]') @> to_jsonb(v_window)) then
      raise exception 'multi-day window must be one of % days', coalesce(d->'multi_day_window_options_days', '[1,7,14]');
    end if;
    if v_window < 1 or v_window > 14 then raise exception 'multi-day window must be between 1 and 14 days'; end if;
    v_starts := now();
    v_ends := v_starts + make_interval(days => v_window);
  else
    if v_hours <= 0 or v_hours > coalesce((d->>'max_deadline_hours')::numeric, 168) then
      raise exception 'deadline must be within % hours', coalesce((d->>'max_deadline_hours')::numeric, 168);
    end if;
    v_ends := now() + make_interval(secs => v_hours * 3600);
  end if;
  if v_me = any(v_friends) then raise exception 'you are already in the battle'; end if;
  if cardinality(v_friends) = 0 and not v_link then raise exception 'invite a friend or create an invite link'; end if;
  if cardinality(v_friends) + 1 > v_max then raise exception 'too many players (max %)', v_max; end if;

  insert into public.battles (created_by, mode, format, metric, duration_s, attempts_allowed,
                              max_participants, invite_expires_at, starts_at, ends_at)
  values (v_me, 'async', v_format, v_metric, v_duration,
          coalesce((d->>'attempts_allowed')::smallint, 1), v_max,
          least(now() + make_interval(secs => coalesce((d->>'invite_expiry_hours')::numeric, 24) * 3600), v_ends),
          v_starts, v_ends)
  returning id into v_id;

  insert into public.battle_participants (battle_id, user_id, invited_by)
  select v_id, f, v_me from unnest(v_friends) f;

  if v_link then
    insert into public.battle_invite_links (battle_id, created_by, max_uses, expires_at)
    values (v_id, v_me,
            least(greatest(coalesce((p->>'linkMaxUses')::integer, (d->>'link_max_uses')::integer, 7), 1), 7, v_max - 1),
            least(now() + make_interval(secs => coalesce((d->>'invite_expiry_hours')::numeric, 24) * 3600), v_ends))
    returning token into v_token;
  end if;
  return jsonb_build_object('battleId', v_id, 'inviteToken', v_token);
end $$;
