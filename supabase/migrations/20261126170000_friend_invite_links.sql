-- Personal friend invite links: https://<web origin>/i/<code>.
--
-- Every person has at most one live link (a random 8-character code). Opening it shows who
-- it's from; Add friend makes the two of you friends right away, with no request to accept.
-- Reset replaces the code; the old one stops working at once. Friends already added stay.
--
-- Limits live in app_settings 'friend_invites' so they can change without a release:
--   resets_per_day  how many new codes one person can make in 24 hours (first link included)
--   adds_per_day    how many people one person can add through links in 24 hours
create table public.friend_invite_links (
  code        text primary key check (code ~ '^[abcdefghjkmnpqrstuvwxyz23456789]{8}$'),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index friend_invite_links_live_idx on public.friend_invite_links (user_id) where revoked_at is null;
create index friend_invite_links_user_idx on public.friend_invite_links (user_id, created_at);
alter table public.friend_invite_links enable row level security;
-- No policies: reached only through the functions below.
revoke all on public.friend_invite_links from public, anon, authenticated;

create table private.friend_invite_redemptions (
  id          bigint generated always as identity primary key,
  code        text not null references public.friend_invite_links (code) on delete cascade,
  inviter_id  uuid not null references public.profiles (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index friend_invite_redemptions_user_idx on private.friend_invite_redemptions (user_id, created_at);
create index friend_invite_redemptions_code_idx on private.friend_invite_redemptions (code);
create index friend_invite_redemptions_inviter_idx on private.friend_invite_redemptions (inviter_id);
alter table private.friend_invite_redemptions enable row level security;
revoke all on private.friend_invite_redemptions from public, anon, authenticated;

insert into public.app_settings (key, value, description) values
  ('friend_invites', '{"resets_per_day": 10, "adds_per_day": 30}'::jsonb,
   'Personal invite links: new codes per person per 24 h, and friends added through links per person per 24 h.')
on conflict (key) do nothing;

-- New push kind: someone used your link and you are now friends.
alter table private.notification_outbox drop constraint notification_outbox_kind_check;
alter table private.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'friend_request', 'friend_accepted', 'friend_joined', 'challenge_invite',
    'invite_accepted', 'invite_declined', 'set_submitted', 'challenge_result',
    'challenge_expired', 'challenge_cancelled', 'challenge_reminder', 'challenge_reminder_half',
    'daily_nudge', 'pass_ping', 'weekly_recap'
  ));

create or replace function private.friend_invite_limit(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when jsonb_typeof(value -> p_key) = 'number' then greatest((value ->> p_key)::numeric, 0)::integer end
       from public.app_settings where key = 'friend_invites'),
    p_default);
$$;

-- 8 characters from 31 (no 0/o, 1/i/l), about 8.5e11 codes.
create or replace function private.new_friend_invite_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea;
  v_code text;
  v_pos integer[] := array[0, 1, 2, 3, 4, 5, 10, 11];  -- fully random bytes of a v4 uuid
  i integer;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    foreach i in array v_pos loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.friend_invite_links where code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function private.issue_friend_invite(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if (select count(*) from public.friend_invite_links
       where user_id = p_user and created_at > now() - interval '1 day')
     >= private.friend_invite_limit('resets_per_day', 10) then
    raise exception 'too many new invite links today';
  end if;
  v_code := private.new_friend_invite_code();
  insert into public.friend_invite_links (code, user_id) values (v_code, p_user);
  return v_code;
end $$;

-- Your live code, made on first use.
create or replace function public.my_friend_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_code text;
begin
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  perform pg_advisory_xact_lock(hashtextextended('friend_invite:' || v_me::text, 0));
  select code into v_code from public.friend_invite_links where user_id = v_me and revoked_at is null;
  if v_code is not null then return v_code; end if;
  return private.issue_friend_invite(v_me);
end $$;

-- Turn the current code off and make a new one.
create or replace function public.reset_friend_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  perform pg_advisory_xact_lock(hashtextextended('friend_invite:' || v_me::text, 0));
  update public.friend_invite_links set revoked_at = now() where user_id = v_me and revoked_at is null;
  return private.issue_friend_invite(v_me);
end $$;

-- Who a link is from. Works signed out (the web page and the app before sign-in use it).
-- status: ok | own | friends | invalid. inviter.userId is included only for signed-in callers. invalid covers a reset or unknown code, a deleted
-- account, and a block in either direction, so the reason is never revealed.
create or replace function public.friend_invite_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  l public.friend_invite_links;
  p public.profiles;
  f public.friendships;
begin
  select * into l from public.friend_invite_links
   where code = lower(btrim(coalesce(p_code, ''))) and revoked_at is null;
  if l.code is not null then select * into p from public.profiles where id = l.user_id; end if;
  if l.code is null or p.id is null then return jsonb_build_object('status', 'invalid'); end if;
  if v_me is not null and v_me <> p.id then
    select * into f from public.friendships
     where user_low = least(v_me, p.id) and user_high = greatest(v_me, p.id);
    if f.status = 'blocked' then return jsonb_build_object('status', 'invalid'); end if;
  end if;
  return jsonb_build_object(
    'status', case when v_me = p.id then 'own' when f.status = 'accepted' then 'friends' else 'ok' end,
    'inviter', jsonb_strip_nulls(jsonb_build_object(
      'username', p.username, 'displayName', p.display_name,
      -- signed in only: the app needs it for Challenge <name>
      'userId', case when v_me is not null then p.id end)));
end $$;

-- Add the link's owner as a friend, right away. Returns 'added', 'already' or 'own'.
-- Any unusable link raises 'invite not found' (same message for every reason).
create or replace function public.redeem_friend_invite(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  l public.friend_invite_links;
  f public.friendships;
begin
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'pick a username first'; end if;
  select * into l from public.friend_invite_links
   where code = lower(btrim(coalesce(p_code, ''))) and revoked_at is null;
  if l.code is null or not exists (select 1 from public.profiles where id = l.user_id) then
    raise exception 'invite not found';
  end if;
  if l.user_id = v_me then return 'own'; end if;

  select * into f from public.friendships
   where user_low = least(v_me, l.user_id) and user_high = greatest(v_me, l.user_id) for update;
  if f.status = 'blocked' then raise exception 'invite not found'; end if;
  if f.status = 'accepted' then return 'already'; end if;

  if (select count(*) from private.friend_invite_redemptions
       where user_id = v_me and created_at > now() - interval '1 day')
     >= private.friend_invite_limit('adds_per_day', 30) then
    raise exception 'too many invite links today';
  end if;

  -- A pending request either way is replaced, so neither side gets a "request accepted" push
  -- on top of the friend_joined one.
  if f.status = 'pending' then
    delete from public.friendships where user_low = f.user_low and user_high = f.user_high;
  end if;
  insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
  values (least(v_me, l.user_id), greatest(v_me, l.user_id), l.user_id, 'accepted', now());
  insert into private.friend_invite_redemptions (code, inviter_id, user_id) values (l.code, l.user_id, v_me);
  perform private.enqueue('friend_joined', array[l.user_id], null, v_me);
  return 'added';
end $$;

revoke execute on function private.friend_invite_limit(text, integer), private.new_friend_invite_code(),
  private.issue_friend_invite(uuid)
  from public, anon, authenticated;
revoke execute on function public.my_friend_invite(), public.reset_friend_invite(),
  public.friend_invite_preview(text), public.redeem_friend_invite(text)
  from public, anon;
grant execute on function public.my_friend_invite(), public.reset_friend_invite(),
  public.friend_invite_preview(text), public.redeem_friend_invite(text)
  to authenticated;
grant execute on function public.friend_invite_preview(text) to anon;
