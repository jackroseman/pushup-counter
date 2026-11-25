-- Why a set ended. Hidden analytics only; nothing reads it for scoring or the UI.
--   'user' = End set / Finish attempt / a challenge timer or pause ended it (the default).
--   'tilt' = the phone stopped lying flat during the set (app 1.2.1+).
-- Older builds never send endReason, so their sets keep the default 'user'.
-- submit_set below is the current definition (after the challenges rename) plus end_reason.

alter table public.sets
  add column end_reason text not null default 'user'
  constraint sets_end_reason_check check (end_reason in ('user', 'tilt'));

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
      return v_set;
    exception when unique_violation then
      if attempt = 2 then raise; end if;
    end;
  end loop;
  raise exception 'could not save set';
end $$;
