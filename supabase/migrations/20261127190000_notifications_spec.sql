-- Align remaining notification enqueue rules with the notification specification:
-- * Accept and decline tell every other invited or accepted participant, not only the creator.
-- * A challenge that expires tells invited and accepted people, including invitees whose
--   invite was marked expired in the same finalize pass. Finalize now sets responded_at
--   so unanswered invites can actually leave 'invited' without violating the participant check.
-- * Window reminders still go to people who already have reps in the window.
-- * Halfway through a window is measured from the window start, not from create time.

create or replace function private.tg_notify_participant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_creator uuid;
  v_others uuid[];
begin
  v_creator := (select created_by from public.challenges where id = new.challenge_id);
  if new.user_id = v_creator then return null; end if;

  select array_agg(p.user_id) into v_others
    from public.challenge_participants p
   where p.challenge_id = new.challenge_id
     and p.user_id is distinct from new.user_id
     and p.status in ('invited', 'accepted')
     and p.left_at is null;

  if tg_op = 'INSERT' and new.status = 'invited' then
    perform private.enqueue('challenge_invite', array[new.user_id], new.challenge_id, coalesce(new.invited_by, v_creator));
  elsif tg_op = 'INSERT' and new.status = 'accepted' then
    perform private.enqueue('invite_accepted', v_others, new.challenge_id, new.user_id);
  elsif tg_op = 'UPDATE' and old.status = 'invited' and new.status in ('accepted', 'declined') then
    perform private.enqueue(
      case when new.status = 'accepted' then 'invite_accepted' else 'invite_declined' end,
      v_others, new.challenge_id, new.user_id);
  end if;
  return null;
end
$fn$;

create or replace function private.tg_notify_battle()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.status = old.status then return null; end if;
  if new.status = 'completed' then
    perform private.enqueue('challenge_result',
      array(select user_id from public.challenge_participants
             where challenge_id = new.id and status in ('accepted', 'forfeited')),
      new.id, null);
  elsif new.status = 'expired' then
    -- Include 'expired' so invitees still hear about it after finalize marks their invite expired.
    perform private.enqueue('challenge_expired',
      array(select user_id from public.challenge_participants
             where challenge_id = new.id
               and status in ('invited', 'accepted', 'expired')
               and left_at is null),
      new.id, null);
  elsif new.status = 'cancelled' then
    perform private.enqueue('challenge_cancelled',
      array(select user_id from public.challenge_participants
             where challenge_id = new.id
               and status in ('invited', 'accepted')
               and left_at is null),
      new.id, new.created_by);
  end if;
  return null;
end
$fn$;

create or replace function private.queue_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
                    and p.left_at is null
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

  for r in
    select b.id, b.created_at, b.ends_at, b.starts_at,
           array(
             select p.user_id from public.challenge_participants p
              where p.challenge_id = b.id
                and (p.status = 'accepted' or (p.status = 'invited' and b.invite_expires_at > now()))
                and p.left_at is null
           ) as todo
      from public.challenges b
     where b.mode = 'async'
       and b.kind in ('total', 'streak', 'team')
       and b.status in ('pending', 'active')
       and b.ends_at > now()
       and b.starts_at is not null
  loop
    if v_hours > 0 and now() >= r.ends_at - make_interval(secs => v_hours * 3600)
       and r.ends_at - r.starts_at > make_interval(secs => v_hours * 3600) then
      perform private.enqueue('challenge_reminder', r.todo, r.id, null);
    elsif v_half and now() >= r.starts_at + (r.ends_at - r.starts_at) / 2
       and r.ends_at - r.starts_at > make_interval(secs => v_hours * 2 * 3600) then
      perform private.enqueue('challenge_reminder_half', r.todo, r.id, null);
    end if;
  end loop;
end
$fn$;

create or replace function public.finalize_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  r record;
  done boolean;
  entrants int;
  v_grace interval := make_interval(secs => least(greatest(coalesce((public.setting('upload_grace_s'))::text::integer, 900), 0), 86400));
  v_still int;
  v_out int;
  v_team integer;
  v_day_closed boolean;
begin
  -- responded_at must be set: battle_participants_check requires it once status leaves invited.
  update public.challenge_participants bp
     set status = 'expired',
         responded_at = coalesce(bp.responded_at, now())
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
    v_still := 0;
    v_out := 0;
    v_team := 0;
    v_day_closed := false;
    if r.kind = 'streak' then
      select count(*) filter (where l.participant_status = 'accepted' and l.eliminated_on is null),
             count(*) filter (where l.eliminated_on is not null)
        into v_still, v_out
        from public.challenge_standings_live l
       where l.challenge_id = r.id;
      v_day_closed := now() > (
        (((r.starts_at at time zone coalesce(r.anchor_time_zone, 'UTC'))::date + 1)::timestamp
          at time zone coalesce(r.anchor_time_zone, 'UTC')) + v_grace);
    elsif r.kind = 'team' then
      select coalesce(max(l.team_total), 0) into v_team
        from public.challenge_standings_live l
       where l.challenge_id = r.id;
    end if;
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
      when r.kind = 'streak' then
        now() > r.ends_at + v_grace
        or v_still = 0
        or (v_still = 1 and v_out >= 1 and v_day_closed)
      when r.kind = 'team' then
        now() > r.ends_at + v_grace
        or v_team >= r.target_reps
      else false
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
               metric, scoring_version, attempts_used, kind,
               days_survived, eliminated_on, team_total, team_target)
        select l.challenge_id, l.user_id, l.participant_status, l.best_set_id,
               l.valid_reps, l.avg_depth_pct, l.tempo_score, l.metric_value, l.rank,
               case
                 when r.kind = 'best_set' then
                   (l.metric_value is not null and l.rank = 1
                    and (select count(*) from public.challenge_standings_live d
                          where d.challenge_id = r.id and d.rank = 1) = 1)
                 when r.kind = 'team' then
                   (l.participant_status = 'accepted' and coalesce(l.team_total, 0) >= r.target_reps)
                 when r.kind = 'streak' then
                   (l.participant_status = 'accepted' and l.rank = 1
                    and (select count(*) from public.challenge_standings_live d
                          where d.challenge_id = r.id and d.rank = 1) = 1)
                 else
                   (l.participant_status = 'accepted' and l.metric_value is not null and l.rank = 1
                    and (select count(*) from public.challenge_standings_live d
                          where d.challenge_id = r.id and d.rank = 1 and d.participant_status = 'accepted') = 1)
               end,
               coalesce(r.metric, 'rep_count'), r.scoring_version, l.attempts_used, r.kind,
               l.days_survived, l.eliminated_on, l.team_total, l.team_target
          from public.challenge_standings_live l
         where l.challenge_id = r.id;
      end if;
      n := n + 1;
    end if;
  end loop;

  perform private.queue_reminders();
  perform private.queue_personal_nudges();
  return n;
end $$;
