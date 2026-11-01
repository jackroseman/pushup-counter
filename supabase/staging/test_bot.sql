-- =====================================================================================
-- STAGING ONLY: a seeded opponent so battles can be tested end to end with ONE phone.
-- Never run this on production. It is not a migration (supabase db push ignores this
-- folder); paste it into the staging SQL editor or run it with execute_sql.
--
-- What @pushup_bot does (cron job 'pushup-bot', every minute):
--   * accepts friend requests sent to it;
--   * accepts battle invites sent to it (in-app invites) and plays its attempt right away,
--     so you see an opponent score before your own attempt;
--   * testing.bot_challenge('<your username>', 'max_reps' | 'timed', 60) makes the bot
--     challenge YOU (it plays first), to test the invite push / accept / play / result flow.
-- Its sets are ordinary rows: a mix of Full, Good and a couple of Shallow reps, so the
-- standings show that Full + Good count and Shallow does not.
--
-- Remove everything again:
--   select cron.unschedule('pushup-bot');
--   drop schema testing cascade;
--   delete from auth.users where id = '00000000-0000-4000-8000-00000000b07a';  -- cascades
-- =====================================================================================

create schema if not exists testing;
revoke all on schema testing from public, anon, authenticated;

insert into auth.users (id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-00000000b07a', 'authenticated', 'authenticated', 'pushup-bot@example.invalid',
        now(), now(), '{"provider": "email", "providers": ["email"]}', '{}')
on conflict (id) do nothing;
insert into public.profiles (id, username, display_name)
values ('00000000-0000-4000-8000-00000000b07a', 'pushup_bot', 'Pushup Bot 🤖')
on conflict (id) do nothing;

create or replace function testing.bot_id() returns uuid language sql immutable set search_path = '' as
$$ select '00000000-0000-4000-8000-00000000b07a'::uuid $$;

-- Records one attempt for the bot: n reps, 1.5 s apart (fits a timed battle's window).
create or replace function testing.bot_play(p_battle uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b      public.battles;
  c      public.detector_configs;
  v_set  uuid;
  v_top  real := 0.50;
  v_n    int;
  v_len  int;
begin
  select * into b from public.battles where id = p_battle;
  select * into c from public.detector_configs order by id desc limit 1;
  if c.id is null then
    insert into public.detector_configs (algorithm_version, floor_distance_m, full_ratio, good_ratio,
        min_count_ratio, top_zone_ratio, min_rep_interval_ms, min_near_duration_ms, smoothing_window,
        proximity_implies_full)
    values (1, 0.08, 0.70, 0.45, 0.25, 0.85, 400, 0, 3, true) returning * into c;
  end if;
  v_n := 10 + floor(random() * 16)::int;                               -- 10..25 reps
  if b.format = 'timed' then v_n := least(v_n, floor((b.duration_s * 1000 - 500) / 1500.0)::int); end if;
  v_len := v_n * 1500 + 1000;

  insert into public.sets (user_id, client_set_id, battle_id, detector_config_id, data_version,
                           app_version, started_at, ended_at, calibrated_top_m, depth_tracking)
  values (testing.bot_id(), 'bot-' || p_battle, p_battle, c.id, 2, 'bot',
          now() - make_interval(secs => v_len / 1000.0), now(), v_top, true)
  returning id into v_set;

  -- Depth ratio per rep: every 5th is Good, the 3rd and 7th are Shallow, the rest Full.
  insert into public.reps (set_id, rep_index, completed_ms, bottom_distance_m, top_distance_m, face_lost_at_bottom)
  select v_set, i, i * 1500,
         (v_top - (v_top - c.floor_distance_m) *
           case when i in (3, 7) then (c.min_count_ratio + c.good_ratio) / 2
                when i % 5 = 0   then (c.good_ratio + c.full_ratio) / 2
                else 0.9 end)::real,
         v_top,
         true   -- no trace is stored for bot sets
  from generate_series(1, v_n) i;
  return v_set;
end $$;

-- One tick: accept requests and invites, then play every open battle not played yet.
create or replace function testing.bot_respond()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  update public.friendships set status = 'accepted', responded_at = now()
   where status = 'pending' and requested_by <> testing.bot_id()
     and testing.bot_id() in (user_low, user_high);

  update public.battle_participants bp set status = 'accepted', responded_at = now()
    from public.battles b
   where b.id = bp.battle_id and bp.user_id = testing.bot_id() and bp.status = 'invited'
     and b.status in ('pending', 'active') and b.invite_expires_at > now();

  for r in
    select b.id from public.battles b
      join public.battle_participants bp on bp.battle_id = b.id and bp.user_id = testing.bot_id()
     where bp.status = 'accepted' and b.mode = 'async'
       and (b.status = 'active' or (b.status = 'pending' and b.created_by = testing.bot_id()))
       and (b.ends_at is null or b.ends_at > now())
       and not exists (select 1 from public.sets s where s.battle_id = b.id and s.user_id = testing.bot_id())
  loop
    perform testing.bot_play(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- The bot challenges you (and becomes your friend first). Returns the battle id.
create or replace function testing.bot_challenge(p_username text, p_format text default 'max_reps', p_duration int default 60)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_res jsonb; v_battle uuid;
begin
  select id into v_user from public.profiles where username = p_username;
  if v_user is null then raise exception 'user % not found', p_username; end if;
  insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
  values (least(v_user, testing.bot_id()), greatest(v_user, testing.bot_id()), testing.bot_id(), 'accepted', now())
  on conflict (user_low, user_high) do update set status = 'accepted', responded_at = now()
    where public.friendships.status = 'pending';
  -- create_battle runs as the bot (auth.uid() reads this claim), for the same rules and pushes.
  perform set_config('request.jwt.claim.sub', testing.bot_id()::text, true);
  v_res := public.create_battle(jsonb_build_object(
    'format', p_format, 'durationS', case when p_format = 'timed' then p_duration end,
    'friendIds', jsonb_build_array(v_user)));
  perform set_config('request.jwt.claim.sub', '', true);
  v_battle := (v_res->>'battleId')::uuid;
  perform testing.bot_play(v_battle);
  return v_battle;
end $$;

revoke all on all functions in schema testing from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pushup-bot', '* * * * *', 'select testing.bot_respond()');
  end if;
end $$;
