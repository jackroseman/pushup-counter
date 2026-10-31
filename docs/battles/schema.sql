-- =====================================================================================
-- Push-up battles: DRAFT Supabase Postgres migration (design doc, not applied anywhere)
-- =====================================================================================
-- Companion to docs/battles/SPEC.md and docs/battles/ARCHITECTURE.md.
-- In Phase 1 this file becomes supabase/migrations/<timestamp>_battles.sql.
--
-- Principles
--   * Tables hold RAW facts only: what the phone measured (distances, ms timings, flags),
--     what users did (invites, accepts, sets) and the rules a battle was created with.
--   * NOTHING derived is stored: no depth ratio, no quality, no rep count, no score, no
--     winner. Those live in views/functions below and are computed at query time, so a
--     formula change or a new metric is a view change, not a data migration.
--   * Battle scoring is versioned (battles.scoring_version) so finished battles keep the
--     result they were decided with even after formulas evolve.
--   * If query-time metrics ever get slow, cache them in MATERIALIZED VIEWS (or summary
--     tables refreshed by triggers/cron) keyed by set_id / battle_id. The views below are
--     the definition of truth; any cache is a disposable copy of them.
--
-- Data provenance (see SPEC.md "Data mapping"): every column in `sets`, `reps` and
-- `set_traces` comes from fields the app already produces (src/core/types.ts Rep,
-- src/storage/history.ts SessionRecord, src/core/trace.ts TracePoint) or from config the
-- app already has (DEFAULT_CONFIG, calibration).
--
-- Supabase specifics assumed: schemas auth / realtime exist, auth.uid() works, roles
-- anon / authenticated / service_role exist. Service-role calls bypass RLS.
-- =====================================================================================

-- Supabase installs extensions into the `extensions` schema (on the default search_path).
-- Keeping citext out of `public` also means the blanket REVOKE below never touches it.
create extension if not exists citext with schema extensions;

-- -------------------------------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------------------------------
create type public.battle_mode   as enum ('async', 'live');
create type public.battle_format as enum ('max_reps', 'timed', 'multi_day');
create type public.battle_metric as enum ('rep_count', 'depth_consistency', 'tempo', 'form_score');
create type public.battle_status as enum ('pending', 'active', 'completed', 'cancelled', 'expired');
-- Participant lifecycle. "submitted" is NOT a status: it is derived from sets existing.
create type public.invite_status as enum ('invited', 'accepted', 'declined', 'expired', 'forfeited');
-- Declared in ascending order on purpose: quality >= 'good' comparisons work.
create type public.rep_quality   as enum ('shallow', 'good', 'full');
create type public.rep_source    as enum ('proximity', 'depth');
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');

-- -------------------------------------------------------------------------------------
-- People
-- -------------------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     extensions.citext not null unique
               check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  -- IANA zone, used for "per day" stats (streaks, multi-day battles).
  time_zone    text not null default 'UTC',
  created_at   timestamptz not null default now()
);

-- One row per app install. Device facts that don't change per set.
create table public.devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  installation_id text not null,          -- random id generated once per install
  model           text,                   -- e.g. "iPhone15,2" (expo-device modelId)
  os_version      text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (user_id, installation_id)
);

-- Expo push tokens (one per device). disabled_at is set when Expo reports
-- DeviceNotRegistered, so we stop sending to it.
create table public.push_tokens (
  device_id       uuid primary key references public.devices (id) on delete cascade,
  expo_push_token text not null unique
                  check (expo_push_token ~ '^(Exponent|Expo)PushToken\[.+\]$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  disabled_at     timestamptz
);

-- Friend graph. One row per unordered pair (user_low < user_high) so a pair can't be
-- duplicated in both directions.
create table public.friendships (
  user_low     uuid not null references public.profiles (id) on delete cascade,
  user_high    uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_low, user_high),
  check (user_low < user_high),
  check (requested_by in (user_low, user_high))
);
create index friendships_user_high_idx on public.friendships (user_high);

-- -------------------------------------------------------------------------------------
-- Battles
-- -------------------------------------------------------------------------------------
create table public.battles (
  id                    uuid primary key default gen_random_uuid(),
  created_by            uuid references public.profiles (id) on delete set null,
  mode                  public.battle_mode   not null,
  format                public.battle_format not null,
  metric                public.battle_metric not null default 'rep_count',
  status                public.battle_status not null default 'pending',

  -- Rules (chosen at creation; facts, not derived)
  duration_s            integer,                         -- timed only (presets 60 / 120)
  min_quality           public.rep_quality not null default 'good', -- weakest rep that scores
  min_reps_for_ranking  smallint not null default 5 check (min_reps_for_ranking between 1 and 100),
  attempts_allowed      smallint not null default 1 check (attempts_allowed between 1 and 5),
  max_participants      smallint not null default 2 check (max_participants between 2 and 8),
  scoring_version       smallint not null default 1,

  -- Time
  invite_expires_at     timestamptz not null,            -- invites not answered by now expire
  starts_at             timestamptz,                     -- live: server-set countdown target; multi_day: window start
  ends_at               timestamptz,                     -- async deadline / multi_day window end
  created_at            timestamptz not null default now(),
  activated_at          timestamptz,
  finished_at           timestamptz,                     -- completed / cancelled / expired

  check (format <> 'timed' or duration_s between 30 and 600),
  check (format =  'timed' or duration_s is null),
  check (mode <> 'live' or (format in ('max_reps', 'timed') and max_participants = 2 and ends_at is null)),
  check (format <> 'multi_day' or (mode = 'async' and starts_at is not null and ends_at is not null
                                   and ends_at - starts_at between interval '1 day' and interval '14 days')),
  check (mode <> 'async' or ends_at is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (invite_expires_at > created_at),
  check ((status in ('completed', 'cancelled', 'expired')) = (finished_at is not null))
);
create index battles_status_idx      on public.battles (status) where status in ('pending', 'active');
create index battles_created_by_idx  on public.battles (created_by);

-- Invite links ("join my battle" URLs) for people who aren't friends yet.
-- Uses are derived (count of participants with invite_link_token = token).
create table public.battle_invite_links (
  token       text primary key default replace(gen_random_uuid()::text, '-', ''),
  battle_id   uuid not null references public.battles (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  max_uses    smallint not null default 1 check (max_uses between 1 and 7),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index battle_invite_links_battle_idx on public.battle_invite_links (battle_id);

-- users <-> battles. One row per person per battle (creator included, auto-accepted).
create table public.battle_participants (
  battle_id         uuid not null references public.battles (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  status            public.invite_status not null default 'invited',
  invited_by        uuid references public.profiles (id) on delete set null,
  invite_link_token text references public.battle_invite_links (token) on delete set null,
  invited_at        timestamptz not null default now(),
  responded_at      timestamptz,
  ready_at          timestamptz,   -- live only: calibrated and pressed Ready (cleared on leaving lobby)
  left_at           timestamptz,   -- forfeited
  primary key (battle_id, user_id),
  check (status = 'invited' or responded_at is not null or invited_by is null),
  check (ready_at is null or status = 'accepted')
);
create index battle_participants_user_idx on public.battle_participants (user_id, status);

-- -------------------------------------------------------------------------------------
-- Measurements
-- -------------------------------------------------------------------------------------

-- Rep-detector settings a set was recorded with (src/core/types.ts DetectorConfig).
-- Shared by many sets, so normalized out; unique on all values.
create table public.detector_configs (
  id                     bigint generated always as identity primary key,
  algorithm_version      smallint     not null,  -- bump when RepDetector logic changes
  floor_distance_m       numeric(5,4) not null,
  full_ratio             numeric(4,3) not null,
  good_ratio             numeric(4,3) not null,
  min_count_ratio        numeric(4,3) not null,
  top_zone_ratio         numeric(4,3) not null,
  min_rep_interval_ms    integer      not null,
  min_near_duration_ms   integer      not null,
  smoothing_window       smallint     not null,
  proximity_implies_full boolean      not null,
  unique (algorithm_version, floor_distance_m, full_ratio, good_ratio, min_count_ratio,
          top_zone_ratio, min_rep_interval_ms, min_near_duration_ms, smoothing_window,
          proximity_implies_full),
  check (floor_distance_m between 0 and 0.5),
  check (0 < min_count_ratio and min_count_ratio <= good_ratio and good_ratio <= full_ratio and full_ratio <= 1),
  check (top_zone_ratio between 0 and 1),
  check (min_rep_interval_ms between 100 and 5000)
);

-- A set = one counting session. Solo sets have battle_id NULL.
create table public.sets (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  client_set_id        text not null,           -- SessionRecord.id; makes uploads idempotent
  battle_id            uuid,                    -- NULL = solo set
  device_id            uuid references public.devices (id) on delete set null,
  detector_config_id   bigint references public.detector_configs (id),  -- NULL only for legacy imports
  data_version         smallint not null default 2,  -- SessionRecord.version (1 = legacy, no timing)
  app_version          text,                    -- e.g. "1.2.0"
  update_id            text,                    -- EAS Update id the JS ran on, if any

  started_at           timestamptz not null,    -- device clock: counting started ("Go")
  ended_at             timestamptz not null,    -- device clock: "End set"
  received_at          timestamptz not null default now(),  -- server clock (anti-cheat)
  clock_offset_ms      integer,                 -- measured server - device clock at set start (live sync)

  calibrated_top_m     real,                    -- Calibration.topDistance (meters)
  calibration_samples  smallint,                -- samples behind the median
  depth_tracking       boolean not null default true,
  proximity_available  boolean,

  unique (user_id, client_set_id),
  -- A battle set must belong to a participant of that battle.
  foreign key (battle_id, user_id)
    references public.battle_participants (battle_id, user_id) on delete cascade,
  check (ended_at >= started_at and ended_at - started_at <= interval '2 hours'),
  check (calibrated_top_m is null or calibrated_top_m between 0.15 and 1.2),
  check (data_version >= 2 or battle_id is null),          -- legacy data never scores
  check (detector_config_id is not null or data_version = 1)
);
create index sets_user_started_idx on public.sets (user_id, started_at desc);
create index sets_battle_idx       on public.sets (battle_id, user_id) where battle_id is not null;

-- One row per counted rep. All times are ms offsets from sets.started_at (device clock),
-- which is exactly how the app measures them; absolute times are derived in views.
create table public.reps (
  set_id               uuid not null references public.sets (id) on delete cascade,
  rep_index            smallint not null check (rep_index >= 1),  -- Rep.index
  started_ms           integer check (started_ms >= 0),           -- Rep.startedAt: descent began (left top zone)
  bottom_ms            integer check (bottom_ms  >= 0),           -- Rep.bottomAt
  completed_ms         integer not null check (completed_ms >= 0),-- Rep.timestamp: back in top zone
  bottom_distance_m    real check (bottom_distance_m > 0 and bottom_distance_m < 2),  -- Rep.bottomDistance (smoothed min)
  top_distance_m       real check (top_distance_m    > 0 and top_distance_m    < 2),  -- Rep.topDistance (max before descent)
  face_lost_at_bottom  boolean not null default false,
  proximity_touched    boolean,                                   -- NULL on legacy sets
  source               public.rep_source not null default 'depth',
  -- Only for data_version = 1 imports that lack raw depth: the label the old app showed.
  legacy_quality       public.rep_quality,
  primary key (set_id, rep_index),
  check (started_ms is null or bottom_ms is null or started_ms <= bottom_ms),
  check (bottom_ms  is null or bottom_ms <= completed_ms),
  check (bottom_distance_m is null or top_distance_m is null or bottom_distance_m <= top_distance_m)
);

-- Downsampled face-distance trace (src/core/trace.ts, ~10 Hz, <= 3000 points).
-- Stored as parallel arrays: one row per set instead of ~3000 rows, still raw data.
create table public.set_traces (
  set_id        uuid primary key references public.sets (id) on delete cascade,
  resolution_ms integer not null check (resolution_ms between 50 and 10000),
  t_ms          integer[] not null,   -- TracePoint[0]
  distance_m    real[]    not null,   -- TracePoint[1]; NULL elements = face not tracked
  check (cardinality(t_ms) = cardinality(distance_m)),
  check (cardinality(t_ms) <= 3001)
);

-- Human / system moderation facts (reports, manual review). Not a score.
create table public.set_flags (
  id          bigint generated always as identity primary key,
  set_id      uuid not null references public.sets (id) on delete cascade,
  rep_index   smallint,
  reason      text not null check (char_length(reason) between 1 and 200),
  flagged_by  uuid references public.profiles (id) on delete set null,  -- NULL = system
  excludes    boolean not null default false,  -- true = a reviewer excluded it from scoring
  created_at  timestamptz not null default now()
);
create index set_flags_set_idx on public.set_flags (set_id);

-- =====================================================================================
-- Helper functions (SECURITY DEFINER where RLS would otherwise recurse)
-- =====================================================================================

-- Is the current user a participant (any status) of the battle?
create or replace function public.is_battle_member(p_battle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.battle_participants
                 where battle_id = p_battle and user_id = (select auth.uid()));
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
                 where user_low = least(a, b) and user_high = greatest(a, b) and status = 'accepted');
$$;

-- Realtime topic "battle:<uuid>" -> only accepted participants may join.
create or replace function public.can_join_battle_channel(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null or p_topic !~ '^battle:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from public.battle_participants
                 where battle_id = substr(p_topic, 8)::uuid
                   and user_id = (select auth.uid()) and status = 'accepted');
end $$;

-- Server clock for live countdown sync (client estimates offset = server - (t0+t1)/2).
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now() $$;

-- Find-or-create the detector config row (clients can't insert detector_configs directly).
create or replace function public.ensure_detector_config(c jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.detector_configs (algorithm_version, floor_distance_m, full_ratio, good_ratio,
      min_count_ratio, top_zone_ratio, min_rep_interval_ms, min_near_duration_ms, smoothing_window,
      proximity_implies_full)
  values ((c->>'algorithmVersion')::smallint, (c->>'floorDistance')::numeric, (c->>'fullRatio')::numeric,
          (c->>'goodRatio')::numeric, (c->>'minCountRatio')::numeric, (c->>'topZoneRatio')::numeric,
          (c->>'minRepIntervalMs')::integer, (c->>'minNearDurationMs')::integer,
          (c->>'smoothingWindow')::smallint, (c->>'proximityImpliesFull')::boolean)
  on conflict (algorithm_version, floor_distance_m, full_ratio, good_ratio, min_count_ratio,
               top_zone_ratio, min_rep_interval_ms, min_near_duration_ms, smoothing_window,
               proximity_implies_full) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.detector_configs
     where algorithm_version = (c->>'algorithmVersion')::smallint
       and floor_distance_m = (c->>'floorDistance')::numeric and full_ratio = (c->>'fullRatio')::numeric
       and good_ratio = (c->>'goodRatio')::numeric and min_count_ratio = (c->>'minCountRatio')::numeric
       and top_zone_ratio = (c->>'topZoneRatio')::numeric
       and min_rep_interval_ms = (c->>'minRepIntervalMs')::integer
       and min_near_duration_ms = (c->>'minNearDurationMs')::integer
       and smoothing_window = (c->>'smoothingWindow')::smallint
       and proximity_implies_full = (c->>'proximityImpliesFull')::boolean;
  end if;
  return v_id;
end $$;

-- Atomic, idempotent set upload: set + reps + trace in one transaction.
-- SECURITY INVOKER: RLS applies. Clients call it for SOLO sets (battle_id must be null by
-- RLS). The submit-set Edge Function calls it with the service role for BATTLE sets after
-- validation, passing p->>'userId' (ignored when called by a signed-in user).
-- Payload = the app's SessionRecord plus { battleId, detectorConfig, appVersion, ... }.
create or replace function public.submit_set(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  -- End users always upload as themselves; only the service role (the submit-set Edge
  -- Function, after validation) may name the owner explicitly.
  v_user  uuid := case when current_user = 'service_role' then (p->>'userId')::uuid
                       else (select auth.uid()) end;
  v_start timestamptz := to_timestamp((p->>'startedAt')::double precision / 1000);
  v_set   uuid;
begin
  if v_user is null then raise exception 'not signed in'; end if;

  select id into v_set from public.sets where user_id = v_user and client_set_id = p->>'id';
  if v_set is not null then return v_set; end if;          -- already uploaded (retry)

  insert into public.sets (user_id, client_set_id, battle_id, device_id, detector_config_id,
      data_version, app_version, update_id, started_at, ended_at, calibrated_top_m,
      calibration_samples, depth_tracking, proximity_available, clock_offset_ms)
  values (v_user, p->>'id', (p->>'battleId')::uuid, (p->>'deviceId')::uuid,
      case when p ? 'detectorConfig' then public.ensure_detector_config(p->'detectorConfig') end,
      coalesce((p->>'version')::smallint, 1), p->>'appVersion', p->>'updateId',
      v_start, to_timestamp((p->>'endedAt')::double precision / 1000),
      (p->>'calibratedTopDistance')::real, (p->>'calibrationSamples')::smallint,
      coalesce((p->>'depthTracking')::boolean, true), (p->>'proximityAvailable')::boolean,
      (p->>'clockOffsetMs')::integer)
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
end $$;

-- =====================================================================================
-- Triggers: battle lifecycle guards (defense in depth; Edge Functions also check)
-- =====================================================================================

-- Creator joins their own battle automatically.
create or replace function public.tg_battle_add_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.battle_participants (battle_id, user_id, status, invited_by, responded_at)
  values (new.id, new.created_by, 'accepted', null, now());
  return new;
end $$;
create trigger battle_add_creator after insert on public.battles
  for each row when (new.created_by is not null) execute function public.tg_battle_add_creator();

-- Participant row rules for signed-in users (service role / cron skip these checks).
create or replace function public.tg_participant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.battles; n int;
begin
  select * into b from public.battles where id = new.battle_id;
  if tg_op = 'INSERT' then
    select count(*) into n from public.battle_participants
     where battle_id = new.battle_id and status in ('invited', 'accepted');
    if n >= b.max_participants then raise exception 'battle is full'; end if;
    return new;
  end if;

  if (select auth.uid()) is null then return new; end if;   -- server-side transition
  if new.battle_id <> old.battle_id or new.user_id <> old.user_id
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

  if new.ready_at is distinct from old.ready_at then
    if b.mode <> 'live' or b.status <> 'active' or b.starts_at is not null then
      raise exception 'ready only in an active live lobby before the start';
    end if;
    if new.ready_at is not null then new.ready_at := now(); end if;
  end if;
  return new;
end $$;
create trigger participant_guard before insert or update on public.battle_participants
  for each row execute function public.tg_participant_guard();

-- After a participant changes: activate the battle / schedule the live start / cancel.
create or replace function public.tg_participant_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.battles; n_open int; n_accepted int; n_ready int;
begin
  select * into b from public.battles where id = new.battle_id for update;
  select count(*) filter (where status in ('invited', 'accepted') and user_id is distinct from b.created_by),
         count(*) filter (where status = 'accepted'),
         count(*) filter (where status = 'accepted' and ready_at is not null)
    into n_open, n_accepted, n_ready
    from public.battle_participants where battle_id = new.battle_id;

  if b.status = 'pending' and n_accepted >= 2 then
    update public.battles set status = 'active', activated_at = now() where id = b.id;
  elsif b.status = 'pending' and n_open = 0 and tg_op = 'UPDATE' and new.status = 'declined' then
    -- everybody invited declined
    update public.battles set status = 'cancelled', finished_at = now() where id = b.id;
  end if;

  -- Live: everyone accepted is ready -> server picks the start (5 s countdown).
  if b.mode = 'live' and b.starts_at is null and n_accepted = b.max_participants
     and n_ready = n_accepted then
    update public.battles set starts_at = now() + interval '5 seconds',
           status = 'active', activated_at = coalesce(activated_at, now())
     where id = b.id;
  end if;
  return null;
end $$;
create trigger participant_after after insert or update on public.battle_participants
  for each row execute function public.tg_participant_after();

-- Battle sets: only in an open battle, by an accepted participant, inside the window,
-- within the attempt limit. Solo sets pass straight through.
create or replace function public.tg_set_battle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.battles; p public.battle_participants; n int;
begin
  if new.battle_id is null then return new; end if;
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
  -- Server clock checks (5 min grace for upload latency / clock skew).
  if b.ends_at is not null and new.received_at > b.ends_at + interval '5 minutes' then
    raise exception 'battle deadline passed';
  end if;
  if b.mode = 'live' and (b.starts_at is null
       or new.received_at > b.starts_at + make_interval(secs => coalesce(b.duration_s, 600)) + interval '5 minutes') then
    raise exception 'live battle window closed';
  end if;
  return new;
end $$;
create trigger set_battle_guard before insert on public.sets
  for each row execute function public.tg_set_battle_guard();

-- Creator cancels a battle nobody has accepted yet.
create or replace function public.cancel_battle(p_battle uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.battles set status = 'cancelled', finished_at = now()
   where id = p_battle and created_by = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'cannot cancel'; end if;
end $$;

-- Periodic housekeeping (pg_cron every minute, and called by submit-set for instant
-- results). Only flips statuses; results themselves are computed by battle_standings.
create or replace function public.finalize_battles()
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; done boolean; entrants int;
begin
  update public.battle_participants bp set status = 'expired'
    from public.battles b
   where b.id = bp.battle_id and bp.status = 'invited' and b.invite_expires_at <= now();

  update public.battles set status = 'expired', finished_at = now()
   where status = 'pending' and invite_expires_at <= now()
     and not exists (select 1 from public.battle_participants p
                      where p.battle_id = battles.id and p.status = 'accepted'
                        and p.user_id is distinct from battles.created_by);

  for r in select * from public.battles where status = 'active' for update skip locked loop
    done := case
      when r.mode = 'live' and r.starts_at is null then
        now() > r.activated_at + interval '15 minutes'          -- lobby abandoned
      when r.mode = 'live' then
        (
          now() > r.starts_at + make_interval(secs => coalesce(r.duration_s, 600)) + interval '5 minutes'
          or not exists (select 1 from public.battle_participants p where p.battle_id = r.id and p.status = 'accepted'
                           and not exists (select 1 from public.sets s where s.battle_id = r.id and s.user_id = p.user_id)))
      when r.format = 'multi_day' then now() > r.ends_at
      else now() > r.ends_at
        or not exists (select 1 from public.battle_participants p where p.battle_id = r.id and p.status = 'accepted'
                         and (select count(*) from public.sets s where s.battle_id = r.id and s.user_id = p.user_id) < r.attempts_allowed)
    end;
    if done then
      select count(distinct user_id) into entrants from public.sets where battle_id = r.id;
      update public.battles
         set status = case when entrants >= 2 then 'completed'::public.battle_status else 'expired'::public.battle_status end,
             finished_at = now()
       where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- =====================================================================================
-- Metrics: computed at query time. NOTHING below is stored.
-- (Later, if needed: CREATE MATERIALIZED VIEW ... AS SELECT * FROM <view> and refresh on
--  battle completion / on a schedule. Keep these views as the source of truth.)
-- =====================================================================================

-- Same formula as src/core/scoring.ts depthRatio().
create or replace function public.depth_ratio(top_m double precision, bottom_m double precision, floor_m double precision)
returns double precision language sql immutable as $$
  select case when top_m is null or bottom_m is null or top_m - floor_m <= 0 then null
              else greatest(0, least(1, (top_m - bottom_m) / (top_m - floor_m))) end;
$$;

-- Per-rep derived values + plausibility (scoring v1). Mirrors RepDetector.completeRep().
create view public.rep_metrics with (security_invoker = true) as
with base as (
  select r.*, s.user_id, s.battle_id, s.started_at as set_started_at,
         s.ended_at as set_ended_at, s.calibrated_top_m, c.floor_distance_m, c.full_ratio, c.good_ratio,
         c.min_count_ratio, c.min_rep_interval_ms, c.proximity_implies_full,
         public.depth_ratio(s.calibrated_top_m, r.bottom_distance_m, c.floor_distance_m::double precision) as tracked_ratio,
         r.completed_ms - lag(r.completed_ms) over (partition by r.set_id order by r.rep_index) as interval_ms
  from public.reps r
  join public.sets s on s.id = r.set_id
  left join public.detector_configs c on c.id = s.detector_config_id
), q as (
  select b.*,
         case when b.proximity_touched and b.proximity_implies_full
              then greatest(coalesce(b.tracked_ratio, 0), b.full_ratio::double precision)
              else b.tracked_ratio end as depth_ratio
  from base b
)
select
  q.set_id, q.rep_index, q.user_id, q.battle_id,
  q.started_ms, q.bottom_ms, q.completed_ms,
  q.set_started_at + make_interval(secs => q.completed_ms / 1000.0) as completed_at,
  q.depth_ratio,
  round(q.depth_ratio * 100)::integer as depth_pct,
  case
    when q.legacy_quality is not null and q.depth_ratio is null then q.legacy_quality
    when q.depth_ratio is null then case when q.proximity_touched then 'full'::public.rep_quality end
    when q.depth_ratio >= q.full_ratio then 'full'::public.rep_quality
    when q.depth_ratio >= q.good_ratio then 'good'::public.rep_quality
    else 'shallow'::public.rep_quality
  end as quality,
  greatest(q.top_distance_m - q.bottom_distance_m, 0) as range_of_motion_m,
  q.bottom_ms - q.started_ms as descent_ms,
  q.completed_ms - q.bottom_ms as ascent_ms,
  q.interval_ms,
  coalesce(q.completed_ms - q.started_ms, q.interval_ms) as rep_time_ms,
  q.face_lost_at_bottom, q.proximity_touched,
  -- First failing rule wins; NULL = plausible. Battle scoring ignores implausible reps.
  case
    when q.interval_ms is not null and q.interval_ms < q.min_rep_interval_ms then 'faster_than_detector_allows'
    when q.started_ms is not null and q.completed_ms - q.started_ms < 300     then 'rep_too_short'
    when q.completed_ms > extract(epoch from q.set_ended_at - q.set_started_at) * 1000 + 1000 then 'after_set_end'
    when q.bottom_distance_m is not null and q.calibrated_top_m is not null
         and q.bottom_distance_m >= q.calibrated_top_m                        then 'bottom_above_top'
    when q.depth_ratio is not null and not coalesce(q.proximity_touched, false)
         and q.depth_ratio < q.min_count_ratio                                then 'below_count_threshold'
    when q.battle_id is not null and q.bottom_ms is not null and q.bottom_distance_m is not null
         and not q.face_lost_at_bottom
         and not exists (                                                     -- trace must show the bottom
           select 1 from public.set_traces t,
                  unnest(t.t_ms, t.distance_m) as pt(ms, d)
            where t.set_id = q.set_id
              and abs(pt.ms - q.bottom_ms) <= greatest(300, 2 * t.resolution_ms)
              and pt.d <= q.bottom_distance_m + 0.03)                         then 'not_in_trace'
    when exists (select 1 from public.set_flags f
                  where f.set_id = q.set_id and f.excludes
                    and (f.rep_index is null or f.rep_index = q.rep_index))   then 'excluded_by_review'
  end as implausible_reason
from q;

-- Per-set analysis. Same metrics as src/core/analysis.ts analyzeSet().
create view public.set_metrics with (security_invoker = true) as
with agg as (
  select set_id,
         count(*)                                        as total_reps,
         count(*) filter (where quality = 'full')        as full_reps,
         count(*) filter (where quality = 'good')        as good_reps,
         count(*) filter (where quality = 'shallow')     as shallow_reps,
         count(*) filter (where implausible_reason is not null) as implausible_reps,
         avg(depth_pct)                                  as avg_depth_pct,
         stddev_pop(depth_pct)                           as depth_std_pct,
         count(depth_pct)                                as depth_samples,
         avg(interval_ms) filter (where interval_ms > 0) as avg_interval_ms,
         percentile_cont(0.5) within group (order by interval_ms) filter (where interval_ms > 0) as median_interval_ms,
         avg(descent_ms)                                 as avg_descent_ms,
         avg(ascent_ms)                                  as avg_ascent_ms,
         min(coalesce(started_ms, 0)) filter (where rep_index = 1) as first_rep_start_ms,
         max(completed_ms)                               as last_rep_ms,
         min(rep_time_ms)                                as fastest_rep_ms,
         max(rep_time_ms)                                as slowest_rep_ms
  from public.rep_metrics group by set_id
), iv as (   -- intervals numbered, for tempo thirds
  select set_id, interval_ms,
         row_number() over (partition by set_id order by rep_index) as k,
         count(*)     over (partition by set_id)                    as m
  from public.rep_metrics where interval_ms > 0
), tempo as (
  select set_id,
         avg(interval_ms) filter (where k <= greatest(1, m / 3))     as first_third_ms,
         avg(interval_ms) filter (where k >  m - greatest(1, m / 3)) as last_third_ms
  from iv where m >= 3 group by set_id
), dp as (   -- depth % numbered, for fatigue (depth change)
  select set_id, depth_pct,
         row_number() over (partition by set_id order by rep_index) as k,
         count(*)     over (partition by set_id)                    as m
  from public.rep_metrics where depth_pct is not null
), depth_thirds as (
  select set_id,
         avg(depth_pct) filter (where k <= greatest(1, m / 3))     as first_third_pct,
         avg(depth_pct) filter (where k >  m - greatest(1, m / 3)) as last_third_pct
  from dp where m >= 3 group by set_id
)
select
  s.id as set_id, s.user_id, s.battle_id, s.started_at, s.ended_at,
  round(extract(epoch from s.ended_at - s.started_at))::integer                 as duration_s,
  coalesce(a.total_reps, 0)    as total_reps,
  coalesce(a.full_reps, 0)     as full_reps,
  coalesce(a.good_reps, 0)     as good_reps,
  coalesce(a.shallow_reps, 0)  as shallow_reps,
  coalesce(a.implausible_reps, 0) as implausible_reps,
  case when a.total_reps > 0 then round(100.0 * a.full_reps / a.total_reps)::integer else 0 end as percent_full,
  round(((a.last_rep_ms - a.first_rep_start_ms) / 1000.0)::numeric, 1)          as active_duration_s,
  case when a.total_reps >= 2 and a.avg_interval_ms > 0
       then round((60000.0 / a.avg_interval_ms)::numeric, 1) end                as reps_per_minute,
  round((a.avg_interval_ms / 1000.0)::numeric, 2)                               as avg_interval_s,
  round((a.median_interval_ms / 1000.0)::numeric, 2)                            as median_interval_s,
  round((t.first_third_ms / 1000.0)::numeric, 2)                                as tempo_first_third_s,
  round((t.last_third_ms  / 1000.0)::numeric, 2)                                as tempo_last_third_s,
  round(100.0 * (t.last_third_ms - t.first_third_ms) / nullif(t.first_third_ms, 0))::integer as tempo_change_pct,
  case when t.first_third_ms is null then null
       when (t.last_third_ms - t.first_third_ms) / t.first_third_ms >  0.10 then 'slowing'
       when (t.last_third_ms - t.first_third_ms) / t.first_third_ms < -0.10 then 'speeding-up'
       else 'steady' end                                                        as tempo_trend,
  round(a.avg_depth_pct)::integer                                               as avg_depth_pct,
  round(a.depth_std_pct::numeric, 1)                                            as depth_std_pct,
  case when a.depth_samples < 2 then null
       when a.depth_std_pct < 6  then 'very consistent'
       when a.depth_std_pct < 12 then 'consistent'
       else 'variable' end                                                      as depth_consistency,
  round(d.last_third_pct - d.first_third_pct)::integer                          as depth_change_pct,
  round((a.avg_descent_ms / 1000.0)::numeric, 2)                                as avg_descent_s,
  round((a.avg_ascent_ms  / 1000.0)::numeric, 2)                                as avg_ascent_s,
  round((a.fastest_rep_ms / 1000.0)::numeric, 2)                                as fastest_rep_s,
  round((a.slowest_rep_ms / 1000.0)::numeric, 2)                                as slowest_rep_s
from public.sets s
left join agg a          on a.set_id = s.id
left join tempo t        on t.set_id = s.id
left join depth_thirds d on d.set_id = s.id;

-- Battle score for one entry, by metric and scoring version. Higher is always better.
--   rep_count          = valid reps
--   depth_consistency  = 100 - 4 * stddev(depth %)       (std 6 -> 76, 12 -> 52, 25 -> 0)
--   tempo              = 100 * (1 - CV of rep intervals)  (rhythm / steadiness)
--   form_score         = 0.5 * avg depth % + 0.3 * depth_consistency + 0.2 * tempo
-- Non rep_count metrics need >= min_reps_for_ranking valid reps, else NULL (unranked).
create or replace function public.battle_metric_value(
  p_metric public.battle_metric, p_version smallint, p_min_reps smallint,
  p_valid_reps bigint, p_avg_depth_pct numeric, p_depth_std_pct numeric,
  p_avg_interval_ms numeric, p_interval_std_ms numeric)
returns numeric language sql immutable as $$
  with c as (
    select greatest(0, 100 - 4 * p_depth_std_pct)                                   as consistency,
           greatest(0, 100 * (1 - p_interval_std_ms / nullif(p_avg_interval_ms, 0))) as tempo
  )
  select case
    when p_version <> 1 then null      -- add new versions as new branches; never edit v1
    when p_metric = 'rep_count' then p_valid_reps::numeric
    when p_valid_reps < p_min_reps then null
    when p_metric = 'depth_consistency' then round(c.consistency, 1)
    when p_metric = 'tempo'             then round(c.tempo, 1)
    when p_metric = 'form_score'        then round(0.5 * p_avg_depth_pct + 0.3 * c.consistency + 0.2 * c.tempo, 1)
  end from c;
$$;

-- One "entry" per participant attempt: a set for max_reps/timed, all sets pooled for
-- multi_day. Applies battle rules: plausible reps, quality >= min_quality, timed window,
-- live start sync (set must start within 30 s of the server start).
create view public.battle_entries with (security_invoker = true) as
with valid as (
  select rm.*, b.format
  from public.rep_metrics rm
  join public.battles b on b.id = rm.battle_id
  where rm.implausible_reason is null
    and rm.quality >= b.min_quality
    and (b.format <> 'timed' or rm.completed_ms <= b.duration_s * 1000)
), entry_sets as (
  select s.*, b.format,
         case when b.format = 'multi_day' then null else s.id end as entry_set_id
  from public.sets s join public.battles b on b.id = s.battle_id
  where b.mode <> 'live'
     or abs(extract(epoch from s.started_at - b.starts_at) + coalesce(s.clock_offset_ms, 0) / 1000.0) <= 30
)
select e.battle_id, e.user_id, e.entry_set_id,
       count(e.id)            as sets,
       min(e.started_at)      as first_started_at,
       max(e.ended_at)        as finished_at,
       count(v.rep_index)     as valid_reps,
       avg(v.depth_pct)       as avg_depth_pct,
       stddev_pop(v.depth_pct) as depth_std_pct,
       avg(v.interval_ms)     as avg_interval_ms,
       stddev_pop(v.interval_ms) as interval_std_ms
from entry_sets e
left join valid v on v.set_id = e.id
group by e.battle_id, e.user_id, e.entry_set_id;

-- Live leaderboard / final result per battle participant. Provisional while active;
-- is_winner only once the battle is completed. Ties share rank 1 (draw).
create view public.battle_standings with (security_invoker = true) as
with scored as (
  select be.*, b.metric,
         public.battle_metric_value(b.metric, b.scoring_version, b.min_reps_for_ranking,
             be.valid_reps, be.avg_depth_pct, be.depth_std_pct, be.avg_interval_ms, be.interval_std_ms) as metric_value
  from public.battle_entries be join public.battles b on b.id = be.battle_id
), best as (   -- best attempt per participant
  select distinct on (battle_id, user_id) *
  from scored
  order by battle_id, user_id, metric_value desc nulls last, valid_reps desc, finished_at asc
)
select p.battle_id, p.user_id, p.status as participant_status, b.status as battle_status, b.metric,
       x.entry_set_id as best_set_id,
       coalesce(x.valid_reps, 0) as valid_reps,
       round(x.avg_depth_pct)::integer as avg_depth_pct,
       x.metric_value,
       x.finished_at,
       (select count(*) from public.sets s where s.battle_id = p.battle_id and s.user_id = p.user_id) as attempts_used,
       rank() over (partition by p.battle_id
                    order by x.metric_value desc nulls last, x.valid_reps desc nulls last, x.finished_at asc nulls last) as rank,
       (b.status = 'completed' and x.metric_value is not null
        and rank() over (partition by p.battle_id
                         order by x.metric_value desc nulls last, x.valid_reps desc nulls last, x.finished_at asc nulls last) = 1) as is_winner
from public.battle_participants p
join public.battles b on b.id = p.battle_id
left join best x on x.battle_id = p.battle_id and x.user_id = p.user_id
where p.status in ('accepted', 'forfeited');

-- Lifetime stats per user (rows for other users only reflect sets you're allowed to see,
-- i.e. shared battles; the app queries its own row).
create view public.user_stats with (security_invoker = true) as
with days as (
  select distinct s.user_id, (s.started_at at time zone p.time_zone)::date as d
  from public.sets s join public.profiles p on p.id = s.user_id
), islands as (
  select user_id, d, d - (row_number() over (partition by user_id order by d))::integer as grp
  from days
), streaks as (
  select user_id, max(d) as last_day, count(*) as len from islands group by user_id, grp
), totals as (
  select sm.user_id, count(*) as total_sets, sum(sm.total_reps) as total_reps,
         max(sm.total_reps) as best_set_reps, sum(sm.full_reps) as total_full_reps,
         max(sm.started_at) as last_set_at
  from public.set_metrics sm group by sm.user_id
), bstats as (
  select user_id,
         count(*) filter (where battle_status = 'completed')                    as battles_played,
         count(*) filter (where battle_status = 'completed' and is_winner)      as battles_won,
         count(*) filter (where battle_status = 'completed' and not is_winner)  as battles_lost
  from public.battle_standings group by user_id
)
select p.id as user_id, p.username,
       coalesce(t.total_sets, 0) as total_sets,
       coalesce(t.total_reps, 0) as total_reps,
       coalesce(t.total_full_reps, 0) as total_full_reps,
       t.best_set_reps, t.last_set_at,
       coalesce((select max(len) from streaks s where s.user_id = p.id), 0) as longest_streak_days,
       coalesce((select s.len from streaks s where s.user_id = p.id
                  and s.last_day >= (now() at time zone p.time_zone)::date - 1
                  order by s.last_day desc limit 1), 0) as current_streak_days,
       coalesce(b.battles_played, 0) as battles_played,
       coalesce(b.battles_won, 0)    as battles_won,
       coalesce(b.battles_lost, 0)   as battles_lost
from public.profiles p
left join totals  t on t.user_id = p.id
left join bstats b on b.user_id = p.id;

-- =====================================================================================
-- Row-level security
-- =====================================================================================
alter table public.profiles            enable row level security;
alter table public.devices             enable row level security;
alter table public.push_tokens         enable row level security;
alter table public.friendships         enable row level security;
alter table public.battles             enable row level security;
alter table public.battle_invite_links enable row level security;
alter table public.battle_participants enable row level security;
alter table public.detector_configs    enable row level security;
alter table public.sets                enable row level security;
alter table public.reps                enable row level security;
alter table public.set_traces          enable row level security;
alter table public.set_flags           enable row level security;

-- profiles: anyone signed in can look people up by username (public fields only);
-- you create/edit only your own.
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- devices / push tokens: own only.
create policy devices_own on public.devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_tokens_own on public.push_tokens for all to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid())));

-- friendships: see pairs you're in; request as yourself; the other side accepts;
-- either side can block or delete (unfriend).
create policy friendships_read on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));
create policy friendships_request on public.friendships for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending'
              and (select auth.uid()) in (user_low, user_high));
create policy friendships_respond on public.friendships for update to authenticated
  using ((select auth.uid()) in (user_low, user_high))
  with check ((select auth.uid()) in (user_low, user_high)
              and (status = 'blocked' or requested_by <> (select auth.uid())));
create policy friendships_delete on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_low, user_high));

-- battles: visible to participants; created by yourself in 'pending'. Status changes
-- happen only through triggers / cancel_battle() / finalize_battles() / Edge Functions.
create policy battles_read on public.battles for select to authenticated
  using (public.is_battle_member(id) or created_by = (select auth.uid()));
create policy battles_create on public.battles for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'pending'
              and activated_at is null and finished_at is null
              and (mode = 'async' or starts_at is null));

-- invite links: only the creator sees/creates them; redemption is an Edge Function.
create policy invite_links_creator on public.battle_invite_links for all to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.battles b where b.id = battle_id
                           and b.created_by = (select auth.uid()) and b.status in ('pending', 'active')));

-- participants: co-participants see each other. The creator invites FRIENDS while the
-- battle is open; each user answers / readies / forfeits only their own row.
create policy participants_read on public.battle_participants for select to authenticated
  using (public.is_battle_member(battle_id));
create policy participants_invite on public.battle_participants for insert to authenticated
  with check (status = 'invited' and invited_by = (select auth.uid()) and invite_link_token is null
              and public.are_friends((select auth.uid()), user_id)
              and exists (select 1 from public.battles b where b.id = battle_id
                           and b.created_by = (select auth.uid()) and b.status in ('pending', 'active')));
create policy participants_self_update on public.battle_participants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- detector configs: readable; written only via ensure_detector_config().
create policy detector_configs_read on public.detector_configs for select to authenticated using (true);

-- sets: you see your own sets, plus every set in a battle you're part of.
-- Clients insert only their own SOLO sets; battle sets come from the submit-set Edge
-- Function (service role). Sets are immutable; you can delete your own solo sets.
create policy sets_read on public.sets for select to authenticated
  using (user_id = (select auth.uid())
         or (battle_id is not null and public.is_battle_member(battle_id)));
create policy sets_insert_solo on public.sets for insert to authenticated
  with check (user_id = (select auth.uid()) and battle_id is null);
create policy sets_delete_solo on public.sets for delete to authenticated
  using (user_id = (select auth.uid()) and battle_id is null);

create policy reps_read on public.reps for select to authenticated
  using (exists (select 1 from public.sets s where s.id = set_id));   -- inherits sets_read
create policy reps_insert_solo on public.reps for insert to authenticated
  with check (exists (select 1 from public.sets s where s.id = set_id
                       and s.user_id = (select auth.uid()) and s.battle_id is null
                       and s.received_at > now() - interval '10 minutes'));

create policy traces_read on public.set_traces for select to authenticated
  using (exists (select 1 from public.sets s where s.id = set_id));
create policy traces_insert_solo on public.set_traces for insert to authenticated
  with check (exists (select 1 from public.sets s where s.id = set_id
                       and s.user_id = (select auth.uid()) and s.battle_id is null
                       and s.received_at > now() - interval '10 minutes'));

-- flags: participants can report a set in their battle; reviewers use the service role.
create policy flags_read on public.set_flags for select to authenticated
  using (exists (select 1 from public.sets s where s.id = set_id));
create policy flags_report on public.set_flags for insert to authenticated
  with check (flagged_by = (select auth.uid()) and excludes = false
              and exists (select 1 from public.sets s where s.id = set_id and s.battle_id is not null));

-- Realtime (Broadcast + Presence) on private channels "battle:<uuid>".
-- Requires "Allow public access" OFF in Realtime settings and { config: { private: true } }.
-- (RLS is already enabled on realtime.messages; don't ALTER it.)
create policy battle_channel_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and public.can_join_battle_channel((select realtime.topic())));
create policy battle_channel_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and public.can_join_battle_channel((select realtime.topic())));

-- =====================================================================================
-- Privileges: nothing for anon; RPCs only for signed-in users.
-- =====================================================================================
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant execute on function public.submit_set(jsonb), public.cancel_battle(uuid),
                          public.server_now(), public.is_battle_member(uuid),
                          public.are_friends(uuid, uuid), public.can_join_battle_channel(text),
                          public.depth_ratio(double precision, double precision, double precision),
                          public.battle_metric_value(public.battle_metric, smallint, smallint, bigint,
                                                     numeric, numeric, numeric, numeric)
  to authenticated, service_role;
grant execute on function public.ensure_detector_config(jsonb) to authenticated, service_role;
grant execute on function public.finalize_battles() to service_role;
grant select on public.rep_metrics, public.set_metrics, public.battle_entries,
                public.battle_standings, public.user_stats to authenticated;
-- Sets: no UPDATE grant at all (immutable).
revoke update on public.sets, public.reps, public.set_traces from authenticated;

-- =====================================================================================
-- Scheduling & notifications (enable in the real migration; shown for completeness)
-- =====================================================================================
-- create extension if not exists pg_cron;
-- select cron.schedule('finalize-battles', '* * * * *', $$ select public.finalize_battles(); $$);
-- select cron.schedule('battle-reminders', '*/15 * * * *',
--   $$ select net.http_post(url := '<project>/functions/v1/notify', body := '{"kind":"reminders"}'::jsonb,
--                           headers := jsonb_build_object('Authorization', 'Bearer ' || <vault secret>)) $$);
-- Database Webhooks (pg_net) -> Edge Function `notify`:
--   battle_participants INSERT (invite), UPDATE of status (accepted/declined),
--   battles UPDATE of status / starts_at (live start, results), sets INSERT with battle_id.
