import type { SupabaseClient } from '@supabase/supabase-js';
import { NudgePrefs, WeekRanks, parseRecapRanks, prefsFromServer } from '../progress/nudges';

function rowFrom(userId: string, prefs: NudgePrefs) {
  return {
    user_id: userId,
    daily_nudge: prefs.dailyNudge,
    pass_ping: prefs.passPing,
    weekly_recap: prefs.weeklyRecap,
    quiet_start: prefs.quietStart,
    quiet_end: prefs.quietEnd,
    nudge_local_time: prefs.nudgeLocalTime,
    recap_weekday: prefs.recapWeekday,
    recap_local_time: prefs.recapLocalTime,
  };
}

/** The signed-in account's row, or null when they are still on the defaults. */
export async function fetchNotificationPrefs(client: SupabaseClient): Promise<NudgePrefs | null> {
  const { data, error } = await client.from('notification_prefs').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return prefsFromServer(data);
}

export async function saveNotificationPrefs(client: SupabaseClient, userId: string, prefs: NudgePrefs): Promise<void> {
  const { error } = await client.from('notification_prefs').upsert(rowFrom(userId, prefs));
  if (error) throw new Error(error.message);
}

/** The caller's ranks for one Monday. Friends' reps stay on the server. */
export async function fetchRecapRanks(client: SupabaseClient, weekStart: string): Promise<WeekRanks> {
  const { data, error } = await client.rpc('my_recap_ranks', { p_week: weekStart });
  if (error) throw new Error(error.message);
  const ranks = parseRecapRanks(data);
  if (!ranks) throw new Error('Recap ranks came back in an unexpected shape.');
  return ranks;
}
