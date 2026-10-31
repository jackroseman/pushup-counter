-- Phase 2b: identity. Username availability, device + push token registration, account
-- deletion. Solo set sync reuses submit_set() from battles_initial.

-- Is this username valid and free? (Usernames are lowercase by the profiles check.)
create or replace function public.username_available(p_username text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(p_username, '') ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles p where p.username::text = p_username);
$$;
revoke execute on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- One row per app install per account. Returns the device id; idempotent.
create or replace function public.register_device(p_installation_id text, p_model text default null,
                                                  p_os_version text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if p_installation_id is null or char_length(p_installation_id) not between 8 and 100 then
    raise exception 'invalid installation id';
  end if;
  insert into public.devices (user_id, installation_id, model, os_version)
  values (v_user, p_installation_id, left(p_model, 64), left(p_os_version, 32))
  on conflict (user_id, installation_id) do update
    set model = excluded.model, os_version = excluded.os_version, last_seen_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.register_device(text, text, text) from public, anon;
grant execute on function public.register_device(text, text, text) to authenticated;

-- Save the Expo push token for one of the caller's devices. SECURITY DEFINER because a
-- token belongs to the phone, not the account: when someone signs out and another account
-- signs in on the same phone, the token moves to the new account's device row, and the
-- old row (invisible to the new account under RLS) must be removed.
create or replace function public.register_push_token(p_device_id uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.devices d
                 where d.id = p_device_id and d.user_id = (select auth.uid())) then
    raise exception 'unknown device';
  end if;
  delete from public.push_tokens where expo_push_token = p_token and device_id <> p_device_id;
  insert into public.push_tokens (device_id, expo_push_token)
  values (p_device_id, p_token)
  on conflict (device_id) do update
    set expo_push_token = excluded.expo_push_token, updated_at = now(), disabled_at = null;
end $$;
revoke execute on function public.register_push_token(uuid, text) from public, anon;
grant execute on function public.register_push_token(uuid, text) to authenticated;

-- Delete the caller's account and everything they own. Deleting auth.users cascades to
-- profiles, and from there to devices, push tokens, friendships, sets (+ reps, traces),
-- battle participation and their own battle results. Battles they created stay for the
-- other players (created_by becomes NULL). Apple token revocation is separate (see
-- docs/battles/ARCHITECTURE.md §2).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = v_user;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Account deletion cascades through ON DELETE SET NULL foreign keys into rows that are
-- otherwise immutable. Let those referential actions (which run inside the FK trigger, so
-- pg_trigger_depth() > 1) null the reference and nothing else; direct updates by users
-- are still rejected exactly as before.
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
  if pg_trigger_depth() > 1
     and (new.invited_by is null or new.invited_by = old.invited_by)
     and (new.invite_link_token is null or new.invite_link_token = old.invite_link_token)
     and (to_jsonb(new) - 'invited_by' - 'invite_link_token')
       = (to_jsonb(old) - 'invited_by' - 'invite_link_token') then
    return new;                                               -- FK ON DELETE SET NULL
  end if;
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

create or replace function public.tg_battle_results_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 and new.best_set_id is null
     and (to_jsonb(new) - 'best_set_id') = (to_jsonb(old) - 'best_set_id') then
    return new;                                               -- FK ON DELETE SET NULL
  end if;
  raise exception 'battle results are locked';
end $$;
