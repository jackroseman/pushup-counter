-- Prefill settings for a rematch: same kind, length, and people, as a
-- create_challenge payload. security_invoker + RLS so only a participant
-- (or the creator) can read the challenge.

create or replace function public.rematch_defaults(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me uuid := private.me();
  v_battle public.challenges%rowtype;
  v_defaults jsonb := coalesce(public.setting('async_battle_defaults'), '{}'::jsonb);
  v_streak jsonb := coalesce(public.setting('streak_lengths'), '{}'::jsonb);
  v_friend_ids uuid[];
  v_duration_days integer;
  v_deadline_hours integer;
  v_raw_hours integer;
  v_duration_s integer;
  v_streak_days integer;
  v_kind_label text;
  v_length_label text;
  v_length integer;
  v_hours_options integer[];
  v_timed integer[];
  v_streak_options integer[];
  v_min_days integer;
  v_max_days integer;
  v_max_deadline integer;
  v_out jsonb;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_battle
    from public.challenges
   where id = p_challenge_id;
  if not found then
    raise exception 'challenge not found';
  end if;

  select coalesce(array_agg(p.user_id order by p.invited_at, p.user_id), '{}'::uuid[])
    into v_friend_ids
    from public.challenge_participants p
   where p.challenge_id = p_challenge_id
     and p.user_id is distinct from v_me
     and p.status not in ('declined', 'expired')
     and private.are_friends(v_me, p.user_id);

  v_kind_label := case v_battle.kind
    when 'best_set' then 'Best set'
    when 'total' then 'Most reps'
    when 'streak' then 'Streak'
    else 'Team goal'
  end;

  if v_battle.kind = 'best_set' then
    v_max_deadline := coalesce((v_defaults->>'max_deadline_hours')::integer, 168);
    select coalesce(array_agg(distinct opt) filter (where opt is not null and opt > 0 and opt <= v_max_deadline), '{}'::integer[])
      into v_hours_options
      from (
        select (x#>>'{}')::integer as opt
          from jsonb_array_elements(coalesce(v_defaults->'deadline_options_hours', '[]'::jsonb)) x
        union
        select coalesce((v_defaults->>'deadline_hours')::integer, 24)
      ) opts;
    if cardinality(v_hours_options) = 0 then
      v_hours_options := array[coalesce((v_defaults->>'deadline_hours')::integer, 24)];
    end if;
    v_raw_hours := case
      when v_battle.ends_at is not null and v_battle.created_at is not null
        then round(extract(epoch from (v_battle.ends_at - v_battle.created_at)) / 3600.0)::integer
      else coalesce((v_defaults->>'deadline_hours')::integer, 24)
    end;
    select opt into v_deadline_hours
      from unnest(v_hours_options) opt
     order by abs(opt - v_raw_hours), opt
     limit 1;

    v_duration_s := v_battle.duration_s;
    if v_duration_s is not null then
      select coalesce(array_agg((x#>>'{}')::integer), '{}'::integer[])
        into v_timed
        from jsonb_array_elements(coalesce(v_defaults->'timed_durations_s', '[60, 120]'::jsonb)) x;
      if cardinality(v_timed) > 0 and not (v_duration_s = any (v_timed)) then
        select opt into v_duration_s
          from unnest(v_timed) opt
         order by abs(opt - v_battle.duration_s), opt
         limit 1;
      end if;
    end if;

    v_length_label := case
      when v_deadline_hours = 168 then '1 week'
      when v_deadline_hours % 24 = 0 and v_deadline_hours = 24 then '1 day'
      when v_deadline_hours % 24 = 0 then (v_deadline_hours / 24)::text || ' days'
      when v_deadline_hours = 1 then '1 hour'
      else v_deadline_hours::text || ' hours'
    end;

    v_out := jsonb_build_object(
      'kind', v_battle.kind,
      'durationS', v_duration_s,
      'deadlineHours', v_deadline_hours,
      'friendIds', to_jsonb(v_friend_ids),
      'kindLabel', v_kind_label,
      'lengthLabel', v_length_label
    );
  elsif v_battle.kind = 'streak' then
    v_min_days := coalesce((v_streak->>'min_days')::integer, 3);
    v_max_days := coalesce((v_streak->>'max_days')::integer, 92);
    select coalesce(array_agg((x#>>'{}')::integer), '{}'::integer[])
      into v_streak_options
      from jsonb_array_elements(coalesce(v_streak->'options_days', '[7, 14, 30]'::jsonb)) x;
    if v_battle.starts_at is not null and v_battle.ends_at is not null then
      v_streak_days := greatest(1, round(extract(epoch from (v_battle.ends_at - v_battle.starts_at)) / 86400.0)::integer);
    else
      v_streak_days := coalesce((v_streak_options)[1], 7);
    end if;
    v_streak_days := least(greatest(v_streak_days, v_min_days), v_max_days);
    if cardinality(v_streak_options) > 0 and not (v_streak_days = any (v_streak_options)) then
      select opt into v_streak_days
        from unnest(v_streak_options) opt
       order by abs(opt - v_streak_days), opt
       limit 1;
    end if;
    v_length_label := v_streak_days::text || case when v_streak_days = 1 then ' day' else ' days' end;
    v_out := jsonb_build_object(
      'kind', v_battle.kind,
      'streakDays', v_streak_days,
      'friendIds', to_jsonb(v_friend_ids),
      'kindLabel', v_kind_label,
      'lengthLabel', v_length_label
    );
  else
    v_duration_days := v_battle.duration_days;
    if v_duration_days is null then
      v_duration_days := case v_battle.window_unit
        when 'day' then 1
        when 'week' then 7
        when 'month' then 30
        else null
      end;
    end if;
    if v_duration_days is null and v_battle.starts_at is not null and v_battle.ends_at is not null then
      v_duration_days := greatest(1, round(extract(epoch from (v_battle.ends_at - v_battle.starts_at)) / 86400.0)::integer);
    end if;
    if v_duration_days is null or v_duration_days not in (1, 7, 14, 30) then
      v_length := coalesce(v_duration_days, 7);
      select opt into v_duration_days
        from unnest(array[1, 7, 14, 30]) opt
       order by abs(opt - v_length), opt
       limit 1;
    end if;
    v_length_label := v_duration_days::text || case when v_duration_days = 1 then ' day' else ' days' end;
    v_out := jsonb_build_object(
      'kind', v_battle.kind,
      'durationDays', v_duration_days,
      'friendIds', to_jsonb(v_friend_ids),
      'kindLabel', v_kind_label,
      'lengthLabel', v_length_label
    );
    if v_battle.kind = 'team' then
      v_out := v_out || jsonb_build_object('targetReps', v_battle.target_reps);
    end if;
  end if;

  return v_out;
end;
$$;

comment on function public.rematch_defaults(uuid) is
  'Prefill settings for a rematch of this challenge (kind, length, people). Only a participant can call it.';

revoke all on function public.rematch_defaults(uuid) from public, anon;
grant execute on function public.rematch_defaults(uuid) to authenticated;
