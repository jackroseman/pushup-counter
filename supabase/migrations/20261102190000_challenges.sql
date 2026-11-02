-- Slice 5: battles become challenges. One transaction.
-- best_set keeps today's claim rules. total counts every eligible set in the frozen window.
-- streak and team are legal shapes (slice 6) but create_challenge rejects them.
-- Old battle screens break until the app that sends challengeId is updated. That is intentional.

-- -------------------------------------------------------------------------------------
-- 1. New types and columns, then backfill from format.
-- -------------------------------------------------------------------------------------
create type public.challenge_kind as enum ('best_set', 'total', 'streak', 'team');
create type public.challenge_window as enum ('day', 'week', 'month', 'custom');

alter table public.battles
  add column kind public.challenge_kind,
  add column window_unit public.challenge_window,
  add column anchor_time_zone text,
  add column target_reps integer;

alter table public.battles alter column metric drop not null;
alter table public.battles alter column attempts_allowed drop not null;

-- Checks that mention format, or the 1–5 attempt cap, block the backfill.
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.battles'::regclass
       and contype = 'c'
       and (pg_get_constraintdef(oid) ~ 'format' or pg_get_constraintdef(oid) ~ 'attempts_allowed')
  loop
    execute format('alter table public.battles drop constraint %I', r.conname);
  end loop;
end $$;

update public.battles b
   set kind = case when b.format = 'multi_day' then 'total'::public.challenge_kind else 'best_set'::public.challenge_kind end,
       window_unit = case when b.format = 'multi_day' then 'custom'::public.challenge_window else null end,
       attempts_allowed = case when b.format = 'multi_day' then null else b.attempts_allowed end,
       metric = case when b.format = 'multi_day' then null else b.metric end,
       anchor_time_zone = case when b.format = 'multi_day'
         then (select p.time_zone from public.profiles p where p.id = b.created_by) else null end;

alter table public.battles alter column kind set not null;

-- -------------------------------------------------------------------------------------
-- 2. Drop standings views (they block the battle_id rename), then rename.
-- -------------------------------------------------------------------------------------
drop view if exists public.battle_standings;
drop view if exists public.battle_standings_live;
drop view if exists public.battle_entries;

alter table public.battles rename to challenges;
alter table public.battle_participants rename to challenge_participants;
alter table public.battle_invite_links rename to challenge_invite_links;
alter table public.battle_results rename to challenge_results;

alter table public.sets rename column battle_id to challenge_id;
alter table public.challenge_participants rename column battle_id to challenge_id;
alter table public.challenge_invite_links rename column battle_id to challenge_id;
alter table public.challenge_results rename column battle_id to challenge_id;
alter table private.notification_outbox rename column battle_id to challenge_id;

-- View output names stay battle_id after the table column rename. The query inside
-- already follows the column (it is stored by id), so only the output name changes.
alter view public.rep_metrics rename column battle_id to challenge_id;
alter view public.set_metrics rename column battle_id to challenge_id;

alter type public.battle_mode rename to challenge_mode;
alter type public.battle_metric rename to challenge_metric;
alter type public.battle_status rename to challenge_status;

alter table public.challenge_participants
  add column streak_floor_reps integer,
  add column joined_time_zone text,
  add constraint challenge_participants_floor
    check (streak_floor_reps is null or streak_floor_reps >= 1);

alter table public.challenge_results
  add column kind public.challenge_kind,
  add column days_survived integer,
  add column eliminated_on date,
  add column team_total integer,
  add column team_target integer;

alter table public.challenge_results alter column metric drop not null;

-- -------------------------------------------------------------------------------------
-- 3. Views. best_set links by challenge_id. total pools sets in the frozen window.
--    security invoker: a member does not see another person's solo sets through this
--    view. my_challenges reads totals through a definer helper instead.
-- -------------------------------------------------------------------------------------
create view public.challenge_entries with (security_invoker = true) as
with valid as (
  select rm.*,
         rm.completed_ms - lag(rm.completed_ms) over (partition by rm.set_id order by rm.rep_index)
           as valid_interval_ms
  from public.rep_metrics rm
  join public.challenges b on b.id = rm.challenge_id
  where b.kind = 'best_set'
    and rm.implausible_reason is null
    and rm.quality >= b.min_quality
    and (b.duration_s is null or rm.completed_ms <= b.duration_s * 1000)
), entry_sets as (
  select s.*, s.id as entry_set_id
  from public.sets s
  join public.challenges b on b.id = s.challenge_id
  where b.kind = 'best_set'
    and (b.mode <> 'live'
         or abs(extract(epoch from s.started_at - b.starts_at) + coalesce(s.clock_offset_ms, 0) / 1000.0) <= 30)
)
select e.challenge_id, e.user_id, e.entry_set_id,
       count(e.id)            as sets,
       min(e.started_at)      as first_started_at,
       max(e.ended_at)        as finished_at,
       count(v.rep_index)     as valid_reps,
       avg(v.depth_pct)       as avg_depth_pct,
       stddev_pop(v.depth_pct) as depth_std_pct,
       count(v.valid_interval_ms)      as interval_count,
       avg(v.valid_interval_ms)        as avg_interval_ms,
       stddev_pop(v.valid_interval_ms) as interval_std_ms
from entry_sets e
left join valid v on v.set_id = e.id
group by e.challenge_id, e.user_id, e.entry_set_id;

create view public.challenge_standings_live with (security_invoker = true) as
with scored as (
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
                                x.tempo_score desc nulls last))::integer as rank
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
         (rank() over (partition by p.challenge_id order by coalesce(w.valid_reps, 0) desc))::integer as rank
  from public.challenge_participants p
  join public.challenges b on b.id = p.challenge_id and b.kind in ('total', 'team')
  left join window_reps w on w.challenge_id = p.challenge_id and w.user_id = p.user_id
  where p.status in ('accepted', 'forfeited')
)
select * from best_rows
union all
select * from total_rows;

create view public.challenge_standings with (security_invoker = true) as
select r.challenge_id, r.user_id, r.participant_status, 'completed'::public.challenge_status as challenge_status,
       r.metric, r.best_set_id, r.valid_reps, r.avg_depth_pct, r.tempo_score, r.metric_value,
       r.attempts_used, r.rank, r.is_winner, true as locked, r.locked_at
from public.challenge_results r
union all
select l.challenge_id, l.user_id, l.participant_status, l.challenge_status,
       l.metric, l.best_set_id, l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value,
       l.attempts_used, l.rank, false as is_winner, false as locked, null::timestamptz as locked_at
from public.challenge_standings_live l
where l.challenge_status <> 'completed';

-- -------------------------------------------------------------------------------------
-- 4. Rewrite function bodies that still name battles. Same function identity, so
--    triggers and policies keep their target. Format-reading functions are replaced
--    just below, before the format column drops.
-- -------------------------------------------------------------------------------------
do $rewrite$
declare
  r record;
  def text;
begin
  -- Snapshot first. Rewriting while scanning pg_proc can see the new rows, and
  -- pg_get_functiondef errors if it is handed an aggregate.
  for r in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind = 'f'
       and p.proname <> 'claim_notifications'
  loop
    def := pg_get_functiondef(r.oid);
    if def !~ 'battle' then continue; end if;
    -- Keep the function identity: names and the claim parameter stay put.
    -- CREATE OR REPLACE cannot rename an input parameter.
    def := replace(def, 'battle_metric_value', '___METRIC_FN___');
    def := replace(def, 'tg_battle_results_immutable', '___RESULTS_FN___');
    def := replace(def, 'finalize_battles', '___FINALIZE_FN___');
    def := replace(def, 'my_battles', '___MY_FN___');
    def := replace(def, 'p_battle_id', '___P_BATTLE_ID___');
    def := replace(def, 'battle_participants', 'challenge_participants');
    def := replace(def, 'battle_invite_links', 'challenge_invite_links');
    def := replace(def, 'battle_results', 'challenge_results');
    def := replace(def, 'battle_standings_live', 'challenge_standings_live');
    def := replace(def, 'battle_entries', 'challenge_entries');
    def := replace(def, 'battle_standings', 'challenge_standings');
    def := replace(def, 'battle_reminder_half', 'challenge_reminder_half');
    def := replace(def, 'battle_reminder', 'challenge_reminder');
    def := replace(def, 'battle_cancelled', 'challenge_cancelled');
    def := replace(def, 'battle_expired', 'challenge_expired');
    def := replace(def, 'battle_invite', 'challenge_invite');
    def := replace(def, 'battle_result', 'challenge_result');
    def := replace(def, 'battle_status', 'challenge_status');
    def := replace(def, 'battle_metric', 'challenge_metric');
    def := replace(def, 'battle_mode', 'challenge_mode');
    def := replace(def, 'battle_id', 'challenge_id');
    def := replace(def, 'battleId', 'challengeId');
    def := replace(def, 'battles', 'challenges');
    def := replace(def, '___METRIC_FN___', 'battle_metric_value');
    def := replace(def, '___RESULTS_FN___', 'tg_battle_results_immutable');
    def := replace(def, '___FINALIZE_FN___', 'finalize_battles');
    def := replace(def, '___MY_FN___', 'my_battles');
    def := replace(def, '___P_BATTLE_ID___', 'p_battle_id');
    begin
      execute def;
    exception when others then
      raise exception 'rewrite of % failed: %', r.oid::regprocedure, sqlerrm;
    end;
  end loop;
end
$rewrite$;

-- A set may carry a challenge id only for a best_set, and only within the attempt cap.
create or replace function private.assert_finished_set_claim(
  p_ended_at timestamptz,
  p_timer_s integer,
  p_data_version integer,
  p_has_config boolean,
  p_battle_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.challenges;
  d jsonb := coalesce(public.setting('async_battle_defaults'), '{}'::jsonb);
  v_age integer := (d->>'claim_set_max_age_s')::integer;
begin
  if v_age is null or v_age < 60 or v_age > 86400 then v_age := 1800; end if;
  select * into b from public.challenges where id = p_battle_id;
  if not found then raise exception 'challenge not found'; end if;
  if b.kind <> 'best_set' then raise exception 'only a best-set challenge can claim a finished set'; end if;
  if b.mode = 'live' then raise exception 'live battles cannot use a finished set'; end if;
  if p_data_version < 2 or not p_has_config then
    raise exception 'set cannot be scored for this battle';
  end if;
  if p_ended_at < now() - make_interval(secs => v_age) or p_ended_at > now() + interval '2 minutes' then
    raise exception 'set is not recent enough to use';
  end if;
  if b.duration_s is not null and p_timer_s is distinct from b.duration_s then
    raise exception 'timed battle duration must match the set timer';
  end if;
end $$;

create or replace function public.tg_set_battle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b public.challenges;
  p public.challenge_participants;
  n int;
  claiming boolean := false;
  v_grace integer := least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400);
begin
  if tg_op = 'UPDATE' then
    if new.challenge_id is not distinct from old.challenge_id then return new; end if;
    if old.challenge_id is not null then raise exception 'set already in a battle'; end if;
    if new.challenge_id is null then raise exception 'a battle set cannot be detached'; end if;
    claiming := true;
  end if;

  if new.challenge_id is null then return new; end if;

  if claiming then
    perform private.assert_finished_set_claim(
      new.ended_at, new.timer_duration_s, new.data_version::integer, new.detector_config_id is not null, new.challenge_id);
  end if;

  select * into b from public.challenges where id = new.challenge_id;
  if b.kind is distinct from 'best_set' then
    raise exception 'only a best-set challenge links a set';
  end if;
  select * into p from public.challenge_participants where challenge_id = new.challenge_id and user_id = new.user_id;
  if p.status is distinct from 'accepted' then raise exception 'not an accepted participant'; end if;
  if not (b.status = 'active' or (b.status = 'pending' and b.mode = 'async' and new.user_id = b.created_by)) then
    raise exception 'battle not open for sets';
  end if;
  select count(*) into n from public.sets where challenge_id = b.id and user_id = new.user_id;
  if n >= b.attempts_allowed then raise exception 'no attempts left'; end if;
  if b.ends_at is not null and new.received_at > b.ends_at + make_interval(secs => v_grace) then
    raise exception 'battle deadline passed';
  end if;
  if b.mode = 'live' and (b.starts_at is null
       or new.received_at > b.starts_at + make_interval(secs => coalesce(b.duration_s, 600)) + make_interval(secs => v_grace)) then
    raise exception 'live battle window closed';
  end if;
  return new;
end $$;

-- Realtime: the new topic is challenge:<uuid>. battle:<uuid> still joins the same room.
create or replace function private.can_join_battle_channel(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_id text;
begin
  if p_topic ~ '^challenge:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substr(p_topic, 11);
  elsif p_topic ~ '^battle:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substr(p_topic, 8);
  else
    return false;
  end if;
  return exists (select 1 from public.challenge_participants
                 where challenge_id = v_id::uuid
                   and user_id = (select auth.uid()) and status = 'accepted');
end $$;

create or replace function public.create_battle(p jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_me       uuid := private.me();
  d          jsonb := coalesce(public.setting('async_battle_defaults'), '{}');
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
begin
  if coalesce(p->>'mode', 'async') <> 'async' then raise exception 'live battles are not available yet'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  begin
    v_kind := (p->>'kind')::public.challenge_kind;
  exception when others then
    raise exception 'kind must be best_set or total';
  end;
  if v_kind is null then raise exception 'kind must be best_set or total'; end if;
  if v_kind in ('streak', 'team') then raise exception 'that challenge is not available yet'; end if;
  if v_kind <> 'best_set' and v_kind <> 'total' then raise exception 'kind must be best_set or total'; end if;

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
  else
    v_metric := null;
    begin
      v_window := (p->>'window')::public.challenge_window;
    exception when others then
      raise exception 'window must be day, week, month, or custom';
    end;
    if v_window is null then raise exception 'window must be day, week, month, or custom'; end if;
    v_local := now() at time zone v_zone;
    if v_window = 'custom' then
      v_starts := (p->>'customStartsAt')::timestamptz;
      v_ends := (p->>'customEndsAt')::timestamptz;
      if v_starts is null or v_ends is null or v_ends <= v_starts then
        raise exception 'custom window needs a start and a later end';
      end if;
      if v_ends - v_starts < interval '1 hour' then raise exception 'custom window must be at least 1 hour'; end if;
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
  end if;

  if v_me = any(v_friends) then raise exception 'you are already in the battle'; end if;
  if cardinality(v_friends) = 0 and not v_link then raise exception 'invite a friend or create an invite link'; end if;
  if cardinality(v_friends) + 1 > v_max then raise exception 'too many players (max %)', v_max; end if;

  insert into public.challenges (created_by, mode, kind, metric, duration_s, attempts_allowed,
                              window_unit, anchor_time_zone, max_participants, invite_expires_at,
                              starts_at, ends_at, scoring_version)
  values (v_me, 'async', v_kind, v_metric, v_duration,
          case when v_kind = 'best_set' then coalesce((d->>'attempts_allowed')::smallint, 1) else null end,
          case when v_kind = 'total' then v_window else null end,
          case when v_kind = 'total' then v_zone else null end,
          v_max,
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

create or replace function private.queue_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := coalesce(public.setting('notifications'), '{}');
  v_hours numeric := coalesce((s->>'reminder_hours_before')::numeric, 2);
  v_half boolean := coalesce((s->>'reminder_at_half_time')::boolean, true);
  r record;
begin
  for r in
    select b.id, b.created_at, b.ends_at,
           array(select p.user_id from public.challenge_participants p
                  where p.challenge_id = b.id
                    and (p.status = 'accepted' or (p.status = 'invited' and b.invite_expires_at > now()))
                    and (select count(*) from public.sets x where x.challenge_id = b.id and x.user_id = p.user_id) < b.attempts_allowed
                ) as todo
      from public.challenges b
     where b.mode = 'async' and b.kind = 'best_set' and b.status in ('pending', 'active') and b.ends_at > now()
  loop
    if v_hours > 0 and now() >= r.ends_at - make_interval(secs => v_hours * 3600)
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 3600) then
      perform private.enqueue('challenge_reminder', r.todo, r.id, null);
    elsif v_half and now() >= r.created_at + (r.ends_at - r.created_at) / 2
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 2 * 3600) then
      perform private.enqueue('challenge_reminder_half', r.todo, r.id, null);
    end if;
  end loop;
end $$;

create or replace function public.finalize_battles()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  r record;
  done boolean;
  entrants int;
  v_grace interval := make_interval(secs => least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400));
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
      else false  -- streak and team lock in slice 6
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
               metric, scoring_version, attempts_used, kind)
        select l.challenge_id, l.user_id, l.participant_status, l.best_set_id,
               l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value, l.rank,
               case when r.kind = 'best_set' then
                 (l.metric_value is not null and l.rank = 1
                  and (select count(*) from public.challenge_standings_live d
                        where d.challenge_id = r.id and d.rank = 1) = 1)
               else
                 (l.participant_status = 'accepted' and l.metric_value is not null and l.rank = 1
                  and (select count(*) from public.challenge_standings_live d
                        where d.challenge_id = r.id and d.rank = 1 and d.participant_status = 'accepted') = 1)
               end,
               coalesce(r.metric, 'rep_count'), r.scoring_version, l.attempts_used, r.kind
          from public.challenge_standings_live l
         where l.challenge_id = r.id;
      end if;
      n := n + 1;
    end if;
  end loop;

  perform private.queue_reminders();
  return n;
end $$;

-- Totals are not visible through set RLS. This helper checks membership, then reads
-- the standings view as its owner so the caller gets aggregates and not raw sets.
create or replace function private.challenge_rows(p_id uuid)
returns setof public.challenge_standings
language plpgsql stable security definer set search_path = public as $$
begin
  if (select auth.uid()) is not null
     and not private.is_battle_member(p_id)
     and not exists (select 1 from public.challenges c where c.id = p_id and c.created_by = (select auth.uid()))
  then
    return;
  end if;
  return query select * from public.challenge_standings where challenge_id = p_id;
end $$;

revoke all on function private.challenge_rows(uuid) from public, anon, authenticated;
grant execute on function private.challenge_rows(uuid) to authenticated, service_role;

create or replace function public.my_battles(p_battle uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
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
                 'tempoScore', s.tempo_score, 'rank', s.rank, 'isWinner', coalesce(s.is_winner, false))
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
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.challenge_invite_links; b public.challenges; v_me uuid := (select auth.uid());
begin
  select * into l from public.challenge_invite_links where token = lower(coalesce(p_token, ''));
  select * into b from public.challenges where id = l.challenge_id;
  if l.token is null or b.id is null then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object(
    'status', coalesce(private.invite_link_problem(l, b), 'ok'),
    'challenge', jsonb_build_object('id', b.id, 'mode', b.mode, 'kind', b.kind, 'windowUnit', b.window_unit,
                'metric', b.metric, 'durationS', b.duration_s, 'status', b.status, 'endsAt', b.ends_at,
                'startsAt', b.starts_at, 'attemptsAllowed', b.attempts_allowed, 'maxParticipants', b.max_participants,
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

create or replace function public.friend_battle_record(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v jsonb;
begin
  if p_user is distinct from v_me and not private.are_friends(v_me, p_user) then
    raise exception 'not friends';
  end if;
  select jsonb_build_object(
    'played', count(*),
    'won',    count(*) filter (where r.is_winner),
    'drawn',  count(*) filter (where not r.is_winner and r.rank = 1 and r.metric_value is not null),
    'lost',   count(*) filter (where not r.is_winner and not (r.rank = 1 and r.metric_value is not null)))
    into v
    from public.challenge_results r where r.user_id = p_user;
  return v || jsonb_build_object('recent', coalesce((
    select jsonb_agg(x order by x->>'finishedAt' desc) from (
      select jsonb_build_object(
               'challengeId', b.id, 'finishedAt', b.finished_at, 'kind', b.kind,
               'windowUnit', b.window_unit, 'metric', b.metric, 'durationS', b.duration_s,
               'players', (select count(*) from public.challenge_results c where c.challenge_id = b.id),
               'me',   jsonb_build_object('rank', m.rank, 'isWinner', m.is_winner, 'validReps', m.valid_reps, 'metricValue', m.metric_value),
               'them', jsonb_build_object('rank', t.rank, 'isWinner', t.is_winner, 'validReps', t.valid_reps, 'metricValue', t.metric_value)) as x
        from public.challenge_results t
        join public.challenge_results m on m.challenge_id = t.challenge_id and m.user_id = v_me
        join public.challenges b on b.id = t.challenge_id
       where t.user_id = p_user and p_user <> v_me
       order by b.finished_at desc limit 10) s), '[]'::jsonb));
end $$;

create or replace function private.notification_facts(p_kind text, p_user uuid, p_battle uuid, p_actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'timeZone', (select time_zone from public.profiles where id = p_user),
    'actor', (select jsonb_build_object('username', username, 'displayName', display_name)
                from public.profiles where id = p_actor),
    'challenge', (select jsonb_build_object('id', b.id, 'kind', b.kind, 'windowUnit', b.window_unit,
                        'metric', b.metric, 'durationS', b.duration_s, 'status', b.status, 'endsAt', b.ends_at,
                        'creator', (select username from public.profiles where id = b.created_by),
                        'creatorIsMe', b.created_by = p_user,
                        'mySetDone', exists (select 1 from public.sets x where x.challenge_id = b.id and x.user_id = p_user))
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
$$;

drop function public.claim_notifications(integer);
create function public.claim_notifications(p_limit integer default 200)
returns table (id bigint, user_id uuid, kind text, challenge_id uuid, facts jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  update private.notification_outbox o set sent_at = now()
   where o.sent_at is null and o.created_at <= now() - interval '1 day';
  delete from private.notification_outbox o where o.created_at < now() - interval '30 days';
  return query
    with picked as (
      select o.id from private.notification_outbox o
       where o.sent_at is null order by o.id limit least(greatest(coalesce(p_limit, 200), 1), 1000)
       for update skip locked
    ), done as (
      update private.notification_outbox o set sent_at = now()
        from picked where o.id = picked.id
      returning o.id, o.user_id, o.kind, o.challenge_id, o.actor_id
    )
    select d.id, d.user_id, d.kind, d.challenge_id,
           private.notification_facts(d.kind, d.user_id, d.challenge_id, d.actor_id)
      from done d order by d.id;
end $$;

revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

-- -------------------------------------------------------------------------------------
-- 5. Rename the functions the spec renames. Grants and policies stay on the same id.
-- -------------------------------------------------------------------------------------
alter function public.finalize_battles() rename to finalize_challenges;
alter function public.create_battle(jsonb) rename to create_challenge;
alter function public.my_battles(uuid) rename to my_challenges;
alter function public.cancel_battle(uuid) rename to cancel_challenge;
alter function public.friend_battle_record(uuid) rename to friend_challenge_record;
alter function private.is_battle_member(uuid) rename to is_challenge_member;
alter function private.can_join_battle_channel(text) rename to can_join_challenge_channel;

-- The helper was created before the rename, so its body still calls the old name.
create or replace function private.challenge_rows(p_id uuid)
returns setof public.challenge_standings
language plpgsql stable security definer set search_path = public as $$
begin
  if (select auth.uid()) is not null
     and not private.is_challenge_member(p_id)
     and not exists (select 1 from public.challenges c where c.id = p_id and c.created_by = (select auth.uid()))
  then
    return;
  end if;
  return query select * from public.challenge_standings where challenge_id = p_id;
end $$;

-- -------------------------------------------------------------------------------------
-- 6. Outbox kinds, then drop format. Update every row so the new check can be strict.
-- -------------------------------------------------------------------------------------
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'private.notification_outbox'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%invite%';
  if cname is not null then
    execute format('alter table private.notification_outbox drop constraint %I', cname);
  end if;
end $$;

update private.notification_outbox
   set kind = replace(kind, 'battle_', 'challenge_')
 where kind like 'battle_%';

alter table private.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'challenge_invite',
                  'invite_accepted', 'invite_declined', 'set_submitted', 'challenge_result',
                  'challenge_expired', 'challenge_cancelled', 'challenge_reminder', 'challenge_reminder_half'));

alter table public.challenges drop column format;
drop type public.battle_format;

alter table public.challenges add constraint challenges_kind_best_set
  check (kind <> 'best_set' or (window_unit is null and target_reps is null));
alter table public.challenges add constraint challenges_kind_window
  check (kind not in ('total', 'team') or (window_unit is not null and ends_at > starts_at));
alter table public.challenges add constraint challenges_team_target
  check (kind <> 'team' or target_reps > 0);
alter table public.challenges add constraint challenges_streak_span
  check (kind <> 'streak' or (ends_at is not null and starts_at is not null
        and ends_at - starts_at between interval '3 days' and interval '92 days'));
alter table public.challenges add constraint challenges_live_kind
  check (mode <> 'live' or (kind = 'best_set' and window_unit is null));
alter table public.challenges add constraint challenges_best_metric
  check (kind <> 'best_set' or (metric is not null and attempts_allowed between 1 and 5));
alter table public.challenges add constraint challenges_other_metric
  check (kind = 'best_set' or (metric is null and attempts_allowed is null));
alter table public.challenges add constraint challenges_duration
  check (duration_s is null or (duration_s between 30 and 600 and metric = 'rep_count' and kind = 'best_set'));
alter table public.challenges add constraint challenges_async_ends
  check (mode <> 'async' or ends_at is not null);

insert into public.app_settings (key, value, description) values
  ('scoring_version', '1', 'Copied onto each new challenge. Best-set formula version 1 is battle_metric_value.'),
  ('challenge_custom_max_days', '92', 'Longest custom challenge window, in days.'),
  ('streak_lengths', '{"options_days": [7, 14, 30], "min_days": 3, "max_days": 92}',
   'Streak face-off lengths. Slice 6 reads these. create_challenge rejects streak until then.'),
  ('team_targets', '{"options": [200, 500, 1000], "min": 10, "max": 100000, "default": 500, "default_window": "week"}',
   'Team goal chips. Slice 6 reads these. create_challenge rejects team until then.')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

do $$
declare r record;
begin
  -- Call pg_get_functiondef only after the namespace filter. In a WHERE clause the
  -- planner may evaluate it on pg_catalog aggregates and error.
  for r in
    select n.nspname, p.proname, p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind = 'f'
  loop
    if pg_get_functiondef(r.oid) ~ 'public\.battles|battle_format|\mbattle_id\M|b\.format' then
      raise exception 'function %.% still mentions a battle column', r.nspname, r.proname;
    end if;
  end loop;
end $$;
