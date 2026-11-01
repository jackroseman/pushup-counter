-- Phase 3: friends, async battles, invite links, push notifications.
--
-- * Friends: all writes go through SECURITY DEFINER RPCs (send / respond / remove / block),
--   so the state machine (and blocks) can't be bypassed with direct table writes.
-- * Battles: create_battle() (async only; live is phase 4), invite links redeemed with
--   invite_preview() / redeem_invite() (these replace the planned redeem-invite Edge
--   Function), my_battles() for the app's lists and detail screen.
-- * Push: triggers write facts ("who did what") into private.notification_outbox; the
--   notify Edge Function drains it ({ drain: true }) and formats the text. Facts are read
--   at send time (claim_notifications), nothing derived is stored.
-- * finalize_battles(): an async battle no longer completes early while invites are still
--   open; queues deadline reminders.
-- Product defaults live in app_settings (async_battle_defaults, notifications).

-- =====================================================================================
-- Settings
-- =====================================================================================
insert into public.app_settings (key, value, description) values
  ('async_battle_defaults',
   '{"deadline_hours": 24, "deadline_options_hours": [6, 24, 72], "max_deadline_hours": 168, "invite_expiry_hours": 24, "timed_durations_s": [60, 120], "attempts_allowed": 1, "link_max_uses": 7, "max_reps_idle_end_s": 15, "max_reps_cap_s": 600}',
   'Async battles: default / allowed deadlines, invite expiry (never after the deadline), timed presets, attempts, invite-link uses, and when a max-reps set auto-ends (no rep for idle_end_s, or cap_s total).'),
  ('notifications', '{"reminder_hours_before": 2, "reminder_at_half_time": true}',
   'Battle reminder pushes to people who have not submitted yet: N hours before the deadline, and at half time.')
on conflict (key) do nothing;

-- Internal server config (not exposed through the Data API).
create table if not exists private.server_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table private.server_config enable row level security;
revoke all on private.server_config from public, anon, authenticated;

-- The notify function registers its own URL so the cron job (pg_net) can kick it.
create or replace function public.register_notify_url(p_url text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_url is null or p_url !~ '^https://[^\s]+$' then raise exception 'invalid url'; end if;
  insert into private.server_config (key, value) values ('notify_url', p_url)
  on conflict (key) do update set value = excluded.value, updated_at = now()
    where private.server_config.value is distinct from excluded.value;
end $$;
revoke execute on function public.register_notify_url(text) from public, anon, authenticated;
grant execute on function public.register_notify_url(text) to service_role;

-- =====================================================================================
-- Friends
-- =====================================================================================
-- Blocks are invisible to the blocked person (they just can't find / add you).
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high)
         and (status <> 'blocked' or requested_by = (select auth.uid())));
drop policy if exists friendships_request on public.friendships;
drop policy if exists friendships_respond on public.friendships;
drop policy if exists friendships_delete on public.friendships;
revoke insert, update, delete, truncate on public.friendships from anon, authenticated;

create or replace function private.me()
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'not signed in'; end if;
  return v;
end $$;

-- Add a friend by @username. A request the other side already sent is accepted instead.
-- Returns 'pending' or 'accepted'.
create or replace function public.send_friend_request(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_to uuid;
  f public.friendships;
begin
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  select id into v_to from public.profiles where username = lower(trim(coalesce(p_username, '')))::extensions.citext;
  if v_to is null then raise exception 'user not found'; end if;
  if v_to = v_me then raise exception 'that is you'; end if;
  select * into f from public.friendships
   where user_low = least(v_me, v_to) and user_high = greatest(v_me, v_to) for update;
  if found then
    if f.status = 'blocked' then raise exception 'user not found'; end if;   -- don't reveal blocks
    if f.status = 'accepted' then return 'accepted'; end if;
    if f.requested_by = v_me then return 'pending'; end if;
    update public.friendships set status = 'accepted', responded_at = now()
     where user_low = f.user_low and user_high = f.user_high;
    return 'accepted';
  end if;
  if (select count(*) from public.friendships
       where requested_by = v_me and status = 'pending') >= 50 then
    raise exception 'too many pending friend requests';
  end if;
  insert into public.friendships (user_low, user_high, requested_by)
  values (least(v_me, v_to), greatest(v_me, v_to), v_me);
  return 'pending';
end $$;

create or replace function public.respond_friend_request(p_user uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where user_low = least(v_me, p_user) and user_high = greatest(v_me, p_user)
       and status = 'pending' and requested_by = p_user;
  else
    delete from public.friendships
     where user_low = least(v_me, p_user) and user_high = greatest(v_me, p_user)
       and status = 'pending' and requested_by = p_user;
  end if;
  if not found then raise exception 'no pending request'; end if;
end $$;

-- Unfriend, or cancel a request you sent. (Blocks are lifted with unblock_user.)
create or replace function public.remove_friend(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  delete from public.friendships
   where user_low = least(v_me, p_user) and user_high = greatest(v_me, p_user) and status <> 'blocked';
end $$;

create or replace function public.block_user(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if p_user is null or p_user = v_me then raise exception 'invalid user'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
  values (least(v_me, p_user), greatest(v_me, p_user), v_me, 'blocked', now())
  on conflict (user_low, user_high) do update
    set status = 'blocked', requested_by = v_me, responded_at = now()
    -- the person who blocked first keeps the block
    where public.friendships.status <> 'blocked';
  -- Open invites between the two of you are declined.
  update public.battle_participants bp set status = 'declined', responded_at = now()
    from public.battles b
   where b.id = bp.battle_id and bp.status = 'invited' and b.status in ('pending', 'active')
     and ((bp.user_id = v_me and b.created_by = p_user) or (bp.user_id = p_user and b.created_by = v_me));
end $$;

create or replace function public.unblock_user(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  delete from public.friendships
   where user_low = least(v_me, p_user) and user_high = greatest(v_me, p_user)
     and status = 'blocked' and requested_by = v_me;
end $$;

-- Friends, requests (both directions) and people you blocked, with public profile fields.
create or replace function public.my_friends()
returns table (user_id uuid, username text, display_name text, relation text, since timestamptz)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.username::text, p.display_name,
         case when f.status = 'accepted' then 'friend'
              when f.status = 'blocked' then 'blocked'
              when f.requested_by = (select auth.uid()) then 'outgoing'
              else 'incoming' end,
         coalesce(f.responded_at, f.created_at)
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_low = (select auth.uid()) then f.user_high else f.user_low end
   where (select auth.uid()) in (f.user_low, f.user_high)
     and (f.status <> 'blocked' or f.requested_by = (select auth.uid()))
   order by 4, p.username;
$$;

-- Username prefix search (2+ chars). Hides you and people who blocked you.
create or replace function public.search_users(p_query text)
returns table (user_id uuid, username text, display_name text, relation text)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as id),
  q as (select replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') as s)
  select p.id, p.username::text, p.display_name,
         case when f.status is null then 'none'
              when f.status = 'accepted' then 'friend'
              when f.status = 'blocked' then 'blocked'
              when f.requested_by = me.id then 'outgoing'
              else 'incoming' end
    from public.profiles p cross join me cross join q
    left join public.friendships f
      on f.user_low = least(me.id, p.id) and f.user_high = greatest(me.id, p.id)
   where me.id is not null and char_length(q.s) >= 2
     and p.username::text like q.s || '%'
     and p.id <> me.id
     and not (f.status is not distinct from 'blocked' and f.requested_by <> me.id)
   order by char_length(p.username::text), p.username
   limit 20;
$$;

-- A friend's battle record: overall W/L/D (battle results only, never solo sets) and your
-- head-to-head battles. Friends only.
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
    from public.battle_results r where r.user_id = p_user;
  return v || jsonb_build_object('recent', coalesce((
    select jsonb_agg(x order by x->>'finishedAt' desc) from (
      select jsonb_build_object(
               'battleId', b.id, 'finishedAt', b.finished_at, 'format', b.format,
               'metric', b.metric, 'durationS', b.duration_s,
               'players', (select count(*) from public.battle_results c where c.battle_id = b.id),
               'me',   jsonb_build_object('rank', m.rank, 'isWinner', m.is_winner, 'validReps', m.valid_reps, 'metricValue', m.metric_value),
               'them', jsonb_build_object('rank', t.rank, 'isWinner', t.is_winner, 'validReps', t.valid_reps, 'metricValue', t.metric_value)) as x
        from public.battle_results t
        join public.battle_results m on m.battle_id = t.battle_id and m.user_id = v_me
        join public.battles b on b.id = t.battle_id
       where t.user_id = p_user and p_user <> v_me
       order by b.finished_at desc limit 10) s), '[]'::jsonb));
end $$;

-- =====================================================================================
-- Battles
-- =====================================================================================

-- If everyone invited declined but an invite link is still usable, keep the battle open.
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
  elsif b.status = 'pending' and n_open = 0 and tg_op = 'UPDATE' and new.status = 'declined'
        and not exists (select 1 from public.battle_invite_links l
                         where l.battle_id = b.id and l.revoked_at is null and l.expires_at > now()) then
    -- everybody invited declined (and no open invite link)
    update public.battles set status = 'cancelled', finished_at = now() where id = b.id;
  end if;

  if b.mode = 'live' and b.starts_at is null and n_accepted = b.max_participants
     and n_ready = n_accepted then
    update public.battles set starts_at = now() + interval '5 seconds',
           status = 'active', activated_at = coalesce(activated_at, now())
     where id = b.id;
  end if;
  return null;
end $$;
revoke execute on function public.tg_participant_after() from public, anon, authenticated;

-- Create an async battle, invite friends, optionally make an invite link.
--   p = { format: 'max_reps'|'timed', metric?, durationS? (timed), deadlineHours?,
--         friendIds?: uuid[], maxParticipants?, inviteLink?: bool, linkMaxUses? }
-- Returns { battleId, inviteToken }. SECURITY INVOKER: RLS checks every insert
-- (creator = you, invitees must be accepted friends).
create or replace function public.create_battle(p jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_me       uuid := private.me();
  d          jsonb := coalesce(public.setting('async_battle_defaults'), '{}');
  v_format   public.battle_format;
  v_metric   public.battle_metric := coalesce(p->>'metric', 'rep_count')::public.battle_metric;
  v_duration integer;
  v_hours    numeric := coalesce((p->>'deadlineHours')::numeric, (d->>'deadline_hours')::numeric, 24);
  v_max      integer := coalesce((p->>'maxParticipants')::integer, (public.setting('async_max_participants'))::integer, 8);
  v_friends  uuid[] := coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(p->'friendIds', '[]')) x), '{}');
  v_link     boolean := coalesce((p->>'inviteLink')::boolean, false);
  v_ends     timestamptz;
  v_id       uuid;
  v_token    text;
begin
  if coalesce(p->>'mode', 'async') <> 'async' then raise exception 'live battles are not available yet'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  v_format := (p->>'format')::public.battle_format;
  if v_format is null or v_format = 'multi_day' then raise exception 'format must be max_reps or timed'; end if;
  if v_format = 'timed' then
    v_duration := (p->>'durationS')::integer;
    if v_duration is null or not (coalesce(d->'timed_durations_s', '[60,120]') @> to_jsonb(v_duration)) then
      raise exception 'timed battles last % seconds', coalesce(d->'timed_durations_s', '[60,120]');
    end if;
    v_metric := 'rep_count';
  end if;
  if v_hours <= 0 or v_hours > coalesce((d->>'max_deadline_hours')::numeric, 168) then
    raise exception 'deadline must be within % hours', coalesce((d->>'max_deadline_hours')::numeric, 168);
  end if;
  if v_me = any(v_friends) then raise exception 'you are already in the battle'; end if;
  if cardinality(v_friends) = 0 and not v_link then raise exception 'invite a friend or create an invite link'; end if;
  if cardinality(v_friends) + 1 > v_max then raise exception 'too many players (max %)', v_max; end if;

  v_ends := now() + make_interval(secs => v_hours * 3600);
  insert into public.battles (created_by, mode, format, metric, duration_s, attempts_allowed,
                              max_participants, invite_expires_at, ends_at)
  values (v_me, 'async', v_format, v_metric, v_duration,
          coalesce((d->>'attempts_allowed')::smallint, 1), v_max,
          least(now() + make_interval(secs => coalesce((d->>'invite_expiry_hours')::numeric, 24) * 3600), v_ends),
          v_ends)
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

-- New invite link for one of your open battles (e.g. after the first one was used up).
create or replace function public.create_invite_link(p_battle uuid, p_max_uses integer default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_me uuid := private.me(); b public.battles; v_token text;
        d jsonb := coalesce(public.setting('async_battle_defaults'), '{}');
begin
  select * into b from public.battles where id = p_battle and created_by = v_me;
  if not found or b.status not in ('pending', 'active') or b.mode <> 'async' then raise exception 'battle not open'; end if;
  insert into public.battle_invite_links (battle_id, created_by, max_uses, expires_at)
  values (b.id, v_me, least(greatest(coalesce(p_max_uses, (d->>'link_max_uses')::integer, 7), 1), 7, b.max_participants - 1),
          least(now() + make_interval(secs => coalesce((d->>'invite_expiry_hours')::numeric, 24) * 3600), b.ends_at))
  returning token into v_token;
  return v_token;
end $$;

create or replace function public.revoke_invite_link(p_token text)
returns void language sql security invoker set search_path = '' as $$
  update public.battle_invite_links set revoked_at = now()
   where token = p_token and created_by = (select auth.uid()) and revoked_at is null;
$$;

-- Why an invite link can't be used right now (null = usable).
create or replace function private.invite_link_problem(l public.battle_invite_links, b public.battles)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when l.token is null or b.id is null then 'not_found'
    when l.revoked_at is not null then 'revoked'
    when b.status not in ('pending', 'active') or now() >= b.ends_at then 'closed'
    when l.expires_at <= now() then 'expired'
    when (select count(*) from public.battle_participants p where p.invite_link_token = l.token) >= l.max_uses then 'used_up'
    when (select count(*) from public.battle_participants p
           where p.battle_id = b.id and p.status in ('invited', 'accepted')) >= b.max_participants then 'full'
    else null end;
$$;

-- Public preview of an invite link (works signed out: the token is the secret).
create or replace function public.invite_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.battle_invite_links; b public.battles; v_me uuid := (select auth.uid());
begin
  select * into l from public.battle_invite_links where token = lower(coalesce(p_token, ''));
  select * into b from public.battles where id = l.battle_id;
  if l.token is null or b.id is null then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object(
    'status', coalesce(private.invite_link_problem(l, b), 'ok'),
    'battle', jsonb_build_object('id', b.id, 'mode', b.mode, 'format', b.format, 'metric', b.metric,
                'durationS', b.duration_s, 'status', b.status, 'endsAt', b.ends_at,
                'attemptsAllowed', b.attempts_allowed, 'maxParticipants', b.max_participants,
                'players', (select count(*) from public.battle_participants p
                             where p.battle_id = b.id and p.status = 'accepted')),
    'creator', (select jsonb_build_object('username', p.username, 'displayName', p.display_name)
                  from public.profiles p where p.id = b.created_by),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'displayName', p.display_name,
                                 'validReps', s.valid_reps, 'metricValue', s.metric_value) order by s.rank)
                          from public.battle_standings_live s join public.profiles p on p.id = s.user_id
                         where s.battle_id = b.id and s.attempts_used > 0), '[]'::jsonb),
    'member', v_me is not null and exists (select 1 from public.battle_participants p
                                            where p.battle_id = b.id and p.user_id = v_me));
end $$;

-- Join a battle through an invite link: you're in (accepted) and become friends with the
-- creator (p_add_friend; the app asks first). Idempotent. Returns the battle id.
create or replace function public.redeem_invite(p_token text, p_add_friend boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  l public.battle_invite_links; b public.battles; bp public.battle_participants; v_problem text;
begin
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  select * into l from public.battle_invite_links where token = lower(coalesce(p_token, '')) for update;
  select * into b from public.battles where id = l.battle_id for update;
  if l.token is null or b.id is null then raise exception 'invite not found'; end if;

  select * into bp from public.battle_participants where battle_id = b.id and user_id = v_me;
  if found then
    if bp.status = 'accepted' then return b.id; end if;
    if bp.status = 'invited' and b.status in ('pending', 'active') and now() < b.ends_at then
      update public.battle_participants set status = 'accepted' where battle_id = b.id and user_id = v_me;
      return b.id;
    end if;
    raise exception 'you already left this battle';
  end if;

  if b.created_by is not null and exists (select 1 from public.friendships f
       where f.user_low = least(v_me, b.created_by) and f.user_high = greatest(v_me, b.created_by)
         and f.status = 'blocked') then
    raise exception 'invite not available';
  end if;
  v_problem := private.invite_link_problem(l, b);
  if v_problem is not null then raise exception 'invite %', replace(v_problem, '_', ' '); end if;

  insert into public.battle_participants (battle_id, user_id, status, invited_by, invite_link_token, responded_at)
  values (b.id, v_me, 'accepted', b.created_by, l.token, now());

  if p_add_friend and b.created_by is not null and b.created_by <> v_me then
    insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
    values (least(v_me, b.created_by), greatest(v_me, b.created_by), b.created_by, 'accepted', now())
    on conflict (user_low, user_high) do update set status = 'accepted', responded_at = now()
      where public.friendships.status = 'pending';
  end if;
  return b.id;
end $$;

-- The app's battle list (p_battle null: open battles + results from the last 30 days) or
-- one battle. SECURITY INVOKER: RLS limits it to battles you're part of.
create or replace function public.my_battles(p_battle uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', b.id, 'mode', b.mode, 'format', b.format, 'metric', b.metric, 'status', b.status,
      'durationS', b.duration_s, 'attemptsAllowed', b.attempts_allowed,
      'maxParticipants', b.max_participants, 'minQuality', b.min_quality,
      'inviteExpiresAt', b.invite_expires_at, 'endsAt', b.ends_at, 'createdAt', b.created_at,
      'finishedAt', b.finished_at, 'createdBy', b.created_by,
      'locked', b.status = 'completed',
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'userId', p.user_id, 'username', pr.username, 'displayName', pr.display_name,
                 'status', p.status, 'isMe', p.user_id = (select auth.uid()),
                 'attemptsUsed', coalesce(s.attempts_used,
                    (select count(*) from public.sets x where x.battle_id = b.id and x.user_id = p.user_id)),
                 'validReps', s.valid_reps, 'metricValue', s.metric_value, 'avgDepthPct', s.avg_depth_pct,
                 'tempoScore', s.tempo_score, 'rank', s.rank, 'isWinner', coalesce(s.is_winner, false))
               order by s.rank nulls last, pr.username), '[]'::jsonb)
          from public.battle_participants p
          left join public.profiles pr on pr.id = p.user_id
          left join public.battle_standings s on s.battle_id = p.battle_id and s.user_id = p.user_id
         where p.battle_id = b.id),
      'inviteLinks', case when b.created_by = (select auth.uid()) then (
        select coalesce(jsonb_agg(jsonb_build_object('token', l.token, 'maxUses', l.max_uses,
                 'expiresAt', l.expires_at,
                 'uses', (select count(*) from public.battle_participants u where u.invite_link_token = l.token))
               order by l.created_at desc), '[]'::jsonb)
          from public.battle_invite_links l
         where l.battle_id = b.id and l.revoked_at is null and l.expires_at > now()) else '[]'::jsonb end
    ) as x
      from public.battles b
     where exists (select 1 from public.battle_participants me
                    where me.battle_id = b.id and me.user_id = (select auth.uid()))
       and (case when p_battle is null
                 then b.status in ('pending', 'active') or b.finished_at > now() - interval '30 days'
                 else b.id = p_battle end)
     order by b.created_at desc
     limit 50) t;
$$;

-- =====================================================================================
-- Notifications outbox
-- =====================================================================================
create table if not exists private.notification_outbox (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,  -- recipient
  kind       text not null check (kind in ('friend_request', 'friend_accepted', 'battle_invite',
               'invite_accepted', 'invite_declined', 'set_submitted', 'battle_result',
               'battle_expired', 'battle_cancelled', 'battle_reminder', 'battle_reminder_half')),
  battle_id  uuid references public.battles (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  -- one push per event (also dedupes reminders / repeated friend requests)
  unique nulls not distinct (kind, user_id, battle_id, actor_id)
);
create index if not exists notification_outbox_unsent_idx on private.notification_outbox (id) where sent_at is null;
create index if not exists notification_outbox_user_idx on private.notification_outbox (user_id);
create index if not exists notification_outbox_battle_idx on private.notification_outbox (battle_id);
create index if not exists notification_outbox_actor_idx on private.notification_outbox (actor_id);
alter table private.notification_outbox enable row level security;
revoke all on private.notification_outbox from public, anon, authenticated;

create or replace function private.enqueue(p_kind text, p_users uuid[], p_battle uuid, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  insert into private.notification_outbox (kind, user_id, battle_id, actor_id)
  select p_kind, u, p_battle, p_actor from unnest(p_users) u
   where u is not null and u is distinct from p_actor
     and exists (select 1 from public.profiles pr where pr.id = u)
  on conflict do nothing;
$$;

create or replace function private.tg_notify_friendship()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_other uuid := case when new.requested_by = new.user_low then new.user_high else new.user_low end;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.enqueue('friend_request', array[v_other], null, new.requested_by);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform private.enqueue('friend_accepted', array[new.requested_by], null, v_other);
  end if;
  return null;
end $$;
drop trigger if exists notify_friendship on public.friendships;
create trigger notify_friendship after insert or update of status on public.friendships
  for each row execute function private.tg_notify_friendship();

create or replace function private.tg_notify_participant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_creator uuid := (select created_by from public.battles where id = new.battle_id);
begin
  if new.user_id = v_creator then return null; end if;
  if tg_op = 'INSERT' and new.status = 'invited' then
    perform private.enqueue('battle_invite', array[new.user_id], new.battle_id, coalesce(new.invited_by, v_creator));
  elsif tg_op = 'INSERT' and new.status = 'accepted' then           -- joined through a link
    perform private.enqueue('invite_accepted', array[v_creator], new.battle_id, new.user_id);
  elsif tg_op = 'UPDATE' and old.status = 'invited' and new.status in ('accepted', 'declined') then
    perform private.enqueue(case when new.status = 'accepted' then 'invite_accepted' else 'invite_declined' end,
                            array[v_creator], new.battle_id, new.user_id);
  end if;
  return null;
end $$;
drop trigger if exists notify_participant on public.battle_participants;
create trigger notify_participant after insert or update of status on public.battle_participants
  for each row execute function private.tg_notify_participant();

create or replace function private.tg_notify_set()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.battle_id is null then return null; end if;
  perform private.enqueue('set_submitted',
    array(select p.user_id from public.battle_participants p
           where p.battle_id = new.battle_id and p.status in ('invited', 'accepted')),
    new.battle_id, new.user_id);
  return null;
end $$;
drop trigger if exists notify_set on public.sets;
create trigger notify_set after insert on public.sets
  for each row execute function private.tg_notify_set();

create or replace function private.tg_notify_battle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = old.status then return null; end if;
  if new.status = 'completed' then
    perform private.enqueue('battle_result',
      array(select user_id from public.battle_participants where battle_id = new.id and status in ('accepted', 'forfeited')),
      new.id, null);
  elsif new.status = 'expired' then
    perform private.enqueue('battle_expired',
      array(select user_id from public.battle_participants where battle_id = new.id and status = 'accepted'),
      new.id, null);
  elsif new.status = 'cancelled' then
    perform private.enqueue('battle_cancelled',
      array(select user_id from public.battle_participants where battle_id = new.id and status in ('invited', 'accepted')),
      new.id, new.created_by);
  end if;
  return null;
end $$;
drop trigger if exists notify_battle on public.battles;
create trigger notify_battle after update of status on public.battles
  for each row execute function private.tg_notify_battle();

-- Reminder pushes to people who haven't used their attempt yet (called by finalize_battles).
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
           array(select p.user_id from public.battle_participants p
                  where p.battle_id = b.id
                    and (p.status = 'accepted' or (p.status = 'invited' and b.invite_expires_at > now()))
                    and (select count(*) from public.sets x where x.battle_id = b.id and x.user_id = p.user_id) < b.attempts_allowed
                ) as todo
      from public.battles b
     where b.mode = 'async' and b.format <> 'multi_day' and b.status in ('pending', 'active') and b.ends_at > now()
  loop
    if v_hours > 0 and now() >= r.ends_at - make_interval(secs => v_hours * 3600)
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 3600) then
      perform private.enqueue('battle_reminder', r.todo, r.id, null);
    elsif v_half and now() >= r.created_at + (r.ends_at - r.created_at) / 2
       and r.ends_at - r.created_at > make_interval(secs => v_hours * 2 * 3600) then
      perform private.enqueue('battle_reminder_half', r.todo, r.id, null);
    end if;
  end loop;
end $$;

-- Facts for one notification, read at send time (the text is built by the notify function).
create or replace function private.notification_facts(p_kind text, p_user uuid, p_battle uuid, p_actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'timeZone', (select time_zone from public.profiles where id = p_user),
    'actor', (select jsonb_build_object('username', username, 'displayName', display_name)
                from public.profiles where id = p_actor),
    'battle', (select jsonb_build_object('id', b.id, 'format', b.format, 'metric', b.metric,
                        'durationS', b.duration_s, 'status', b.status, 'endsAt', b.ends_at,
                        'creator', (select username from public.profiles where id = b.created_by),
                        'creatorIsMe', b.created_by = p_user,
                        'mySetDone', exists (select 1 from public.sets x where x.battle_id = b.id and x.user_id = p_user))
                 from public.battles b where b.id = p_battle),
    'actorScore', case when p_kind = 'set_submitted' then
        (select jsonb_build_object('validReps', valid_reps, 'metricValue', metric_value)
           from public.battle_standings_live where battle_id = p_battle and user_id = p_actor) end,
    -- best posted score (for reminders and invites: "beat Sunny's 32")
    'leader', case when p_kind in ('battle_invite', 'battle_reminder', 'battle_reminder_half') then
        (select jsonb_build_object('username', pr.username, 'validReps', l.valid_reps, 'metricValue', l.metric_value)
           from public.battle_standings_live l left join public.profiles pr on pr.id = l.user_id
          where l.battle_id = p_battle and l.attempts_used > 0 and l.user_id <> p_user
          order by l.rank limit 1) end,
    'result', case when p_kind = 'battle_result' then
        (select jsonb_build_object(
                  'rank', me.rank, 'isWinner', me.is_winner, 'validReps', me.valid_reps,
                  'metricValue', me.metric_value,
                  'players', (select count(*) from public.battle_results c where c.battle_id = p_battle),
                  'draw', (select count(*) from public.battle_results c
                            where c.battle_id = p_battle and c.rank = 1 and c.metric_value is not null) > 1,
                  'top', (select jsonb_agg(jsonb_build_object('username', pr.username, 'rank', c.rank,
                                  'validReps', c.valid_reps, 'metricValue', c.metric_value,
                                  'isWinner', c.is_winner, 'isMe', c.user_id = p_user) order by c.rank, pr.username)
                            from public.battle_results c left join public.profiles pr on pr.id = c.user_id
                           where c.battle_id = p_battle and c.rank <= 2))
           from public.battle_results me where me.battle_id = p_battle and me.user_id = p_user) end
  ));
$$;

-- For the notify function (service role): take up to p_limit unsent notifications, mark
-- them sent, and return them with their facts. Notifications older than a day are dropped.
create or replace function public.claim_notifications(p_limit integer default 200)
returns table (id bigint, user_id uuid, kind text, battle_id uuid, facts jsonb)
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
      returning o.id, o.user_id, o.kind, o.battle_id, o.actor_id
    )
    select d.id, d.user_id, d.kind, d.battle_id,
           private.notification_facts(d.kind, d.user_id, d.battle_id, d.actor_id)
      from done d order by d.id;
end $$;

-- Is there anything to send? (cron checks this before waking the notify function)
create or replace function private.has_unsent_notifications()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.notification_outbox where sent_at is null);
$$;

-- =====================================================================================
-- finalize_battles: as before, plus (a) an async battle with invites still open isn't
-- finished just because everyone who accepted has played, (b) queues reminders.
-- =====================================================================================
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
                        and p.user_id is distinct from battles.created_by)
     and not exists (select 1 from public.battle_invite_links l
                      where l.battle_id = battles.id and l.revoked_at is null and l.expires_at > now());
  -- a pending battle can't outlive its deadline
  update public.battles set status = 'expired', finished_at = now()
   where status = 'pending' and ends_at is not null and ends_at <= now();

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
        or (not exists (select 1 from public.battle_participants p where p.battle_id = r.id and p.status = 'accepted'
                         and (select count(*) from public.sets s where s.battle_id = r.id and s.user_id = p.user_id) < r.attempts_allowed)
            and not exists (select 1 from public.battle_participants p where p.battle_id = r.id and p.status = 'invited')
            and not exists (select 1 from public.battle_invite_links l
                             where l.battle_id = r.id and l.revoked_at is null and l.expires_at > now()
                               and (select count(*) from public.battle_participants u where u.invite_link_token = l.token) < l.max_uses
                               and (select count(*) from public.battle_participants u
                                     where u.battle_id = r.id and u.status in ('invited', 'accepted')) < r.max_participants))
    end;
    if done then
      select count(distinct user_id) into entrants from public.sets where battle_id = r.id;
      update public.battles
         set status = case when entrants >= 2 then 'completed'::public.battle_status else 'expired'::public.battle_status end,
             finished_at = now()
       where id = r.id;
      if entrants >= 2 then
        insert into public.battle_results (battle_id, user_id, participant_status, best_set_id,
               valid_reps, avg_depth_pct, tempo_score, metric_value, rank, is_winner,
               metric, scoring_version, attempts_used)
        select l.battle_id, l.user_id, l.participant_status, l.best_set_id,
               l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value, l.rank,
               (l.metric_value is not null and l.rank = 1
                and (select count(*) from public.battle_standings_live d
                      where d.battle_id = r.id and d.rank = 1) = 1),
               r.metric, r.scoring_version, l.attempts_used
          from public.battle_standings_live l
         where l.battle_id = r.id;
      end if;
      n := n + 1;
    end if;
  end loop;

  perform private.queue_reminders();
  return n;
end $$;

-- =====================================================================================
-- Privileges
-- =====================================================================================
revoke execute on function public.finalize_battles() from public, anon, authenticated;
grant execute on function public.finalize_battles() to service_role;

revoke execute on function private.me(), private.enqueue(text, uuid[], uuid, uuid),
  private.tg_notify_friendship(), private.tg_notify_participant(), private.tg_notify_set(),
  private.tg_notify_battle(), private.queue_reminders(),
  private.notification_facts(text, uuid, uuid, uuid), private.has_unsent_notifications(),
  private.invite_link_problem(public.battle_invite_links, public.battles)
  from public, anon, authenticated;
-- invoker functions below call private.me()
grant execute on function private.me() to authenticated, service_role;

revoke execute on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.block_user(uuid), public.unblock_user(uuid), public.my_friends(),
  public.search_users(text), public.friend_battle_record(uuid), public.create_battle(jsonb),
  public.create_invite_link(uuid, integer), public.revoke_invite_link(text),
  public.invite_preview(text), public.redeem_invite(text, boolean), public.my_battles(uuid),
  public.claim_notifications(integer)
  from public, anon;
grant execute on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.block_user(uuid), public.unblock_user(uuid), public.my_friends(),
  public.search_users(text), public.friend_battle_record(uuid), public.create_battle(jsonb),
  public.create_invite_link(uuid, integer), public.revoke_invite_link(text),
  public.invite_preview(text), public.redeem_invite(text, boolean), public.my_battles(uuid)
  to authenticated;
grant execute on function public.invite_preview(text) to anon;
revoke execute on function public.claim_notifications(integer) from authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

-- =====================================================================================
-- set_metrics.good_or_better_reps. full_reps / good_reps / shallow_reps are DISJOINT buckets,
-- like the app's Full / Good / Shallow stats ("good_reps" = Good but NOT Full). The SPEC's
-- "good reps" (what a battle counts) means Good-or-better and plausible: full + good minus
-- implausible. battle_entries already counts that way (quality >= min_quality, and 'full'
-- > 'good' in the enum), but reading set_metrics.good_reps as "battle reps" undercounts
-- (e.g. a 15-rep set with 12 Full + 3 Good shows good_reps = 3; a battle counts 15).
-- This column states the battle number directly.
-- (Appended at the end: CREATE OR REPLACE VIEW can only add trailing columns.)
-- =====================================================================================
create or replace view public.set_metrics with (security_invoker = true) as
with agg as (
  select set_id,
         count(*)                                        as total_reps,
         count(*) filter (where quality = 'full')        as full_reps,
         count(*) filter (where quality = 'good')        as good_reps,
         count(*) filter (where quality = 'shallow')     as shallow_reps,
         count(*) filter (where quality >= 'good' and implausible_reason is null) as good_or_better_reps,
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
  round((a.slowest_rep_ms / 1000.0)::numeric, 2)                                as slowest_rep_s,
  coalesce(a.good_or_better_reps, 0)  as good_or_better_reps
from public.sets s
left join agg a          on a.set_id = s.id
left join tempo t        on t.set_id = s.id
left join depth_thirds d on d.set_id = s.id;
