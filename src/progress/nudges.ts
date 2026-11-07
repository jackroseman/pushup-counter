import { KeyValueStore } from '../storage/history';
import { addCalendarDays, isoWeekday, localDate, weekStart } from './calendar';
import { GoalEnrollment, goalForDate } from './goals';
import { Workout, workoutDate } from './workouts';

/** Same fields as notification_prefs. No row on the server means these defaults. */
export interface NudgePrefs {
  dailyNudge: boolean;
  passPing: boolean;
  weeklyRecap: boolean;
  quietStart: string;
  quietEnd: string;
  nudgeLocalTime: string;
  recapWeekday: number;
  recapLocalTime: string;
}

export const NUDGE_KEY = 'pushupcounter.nudges.v1';

export const DEFAULT_NUDGE_PREFS: NudgePrefs = {
  dailyNudge: true,
  passPing: true,
  weeklyRecap: true,
  quietStart: '21:00',
  quietEnd: '08:00',
  nudgeLocalTime: '18:00',
  recapWeekday: 7,
  recapLocalTime: '18:00',
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sanitizeNudges(raw: unknown): NudgePrefs {
  const out: NudgePrefs = { ...DEFAULT_NUDGE_PREFS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const row = raw as Record<string, unknown>;
  if (typeof row.dailyNudge === 'boolean') out.dailyNudge = row.dailyNudge;
  if (typeof row.passPing === 'boolean') out.passPing = row.passPing;
  if (typeof row.weeklyRecap === 'boolean') out.weeklyRecap = row.weeklyRecap;
  if (typeof row.quietStart === 'string' && CLOCK.test(row.quietStart)) out.quietStart = row.quietStart;
  if (typeof row.quietEnd === 'string' && CLOCK.test(row.quietEnd)) out.quietEnd = row.quietEnd;
  if (typeof row.nudgeLocalTime === 'string' && CLOCK.test(row.nudgeLocalTime)) out.nudgeLocalTime = row.nudgeLocalTime;
  if (typeof row.recapLocalTime === 'string' && CLOCK.test(row.recapLocalTime)) out.recapLocalTime = row.recapLocalTime;
  if (typeof row.recapWeekday === 'number' && Number.isInteger(row.recapWeekday) && row.recapWeekday >= 1 && row.recapWeekday <= 7) {
    out.recapWeekday = row.recapWeekday;
  }
  return out;
}

export async function loadNudges(kv: KeyValueStore): Promise<NudgePrefs> {
  try {
    const raw = await kv.getItem(NUDGE_KEY);
    return raw ? sanitizeNudges(JSON.parse(raw)) : { ...DEFAULT_NUDGE_PREFS };
  } catch {
    return { ...DEFAULT_NUDGE_PREFS };
  }
}

export async function saveNudges(kv: KeyValueStore, prefs: NudgePrefs): Promise<void> {
  await kv.setItem(NUDGE_KEY, JSON.stringify(sanitizeNudges(prefs)));
}

export const NUDGE_SYNC_KEY = 'pushupcounter.nudgeSync.v1';
export const NUDGE_FIRED_KEY = 'pushupcounter.nudges.fired.v1';
export const DAILY_NUDGE_ID = 'daily-nudge';

export interface NudgeSyncState {
  userId: string;
  settled: boolean;
}

export type NudgeSyncAction =
  | { type: 'none' }
  | { type: 'adopt'; prefs: NudgePrefs }
  | { type: 'upload'; prefs: NudgePrefs };

function clockOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** A notification_prefs row. Null when the account has no row yet. */
export function prefsFromServer(raw: unknown): NudgePrefs | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const quietStart = clockOf(row.quiet_start);
  const quietEnd = clockOf(row.quiet_end);
  const nudgeLocalTime = clockOf(row.nudge_local_time);
  const recapLocalTime = clockOf(row.recap_local_time);
  const weekday = typeof row.recap_weekday === 'number' ? row.recap_weekday : Number(row.recap_weekday);
  if (!quietStart || !quietEnd || !nudgeLocalTime || !recapLocalTime) return null;
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  if (typeof row.daily_nudge !== 'boolean' || typeof row.pass_ping !== 'boolean' || typeof row.weekly_recap !== 'boolean') return null;
  return {
    dailyNudge: row.daily_nudge,
    passPing: row.pass_ping,
    weeklyRecap: row.weekly_recap,
    quietStart,
    quietEnd,
    nudgeLocalTime,
    recapWeekday: weekday,
    recapLocalTime,
  };
}

export function sanitizeNudgeSync(raw: unknown): NudgeSyncState | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { userId?: unknown; settled?: unknown };
  if (typeof row.userId !== 'string' || row.userId.length === 0) return null;
  return { userId: row.userId, settled: row.settled === true };
}

/**
 * Same rule as goals. A server row wins. The phone uploads its prefs only
 * when this account has no row and this sign-in has not settled. Another
 * account's prefs on this phone are not uploaded onto a new account.
 */
export function decideNudgeSync(input: {
  userId: string;
  local: NudgePrefs;
  server: NudgePrefs | null;
  sync: NudgeSyncState | null;
}): { action: NudgeSyncAction; next: NudgeSyncState } {
  if (input.server) {
    return { action: { type: 'adopt', prefs: input.server }, next: { userId: input.userId, settled: true } };
  }
  if (input.sync && input.sync.userId !== input.userId) {
    return { action: { type: 'adopt', prefs: { ...DEFAULT_NUDGE_PREFS } }, next: { userId: input.userId, settled: true } };
  }
  const sync = input.sync ?? { userId: input.userId, settled: false };
  if (!sync.settled) {
    return { action: { type: 'upload', prefs: sanitizeNudges(input.local) }, next: { userId: input.userId, settled: false } };
  }
  return { action: { type: 'none' }, next: { userId: input.userId, settled: true } };
}

/** Step a clock by whole minutes, wrapping the day. */
export function shiftClock(hhmm: string, deltaMinutes: number): string {
  const safe = CLOCK.test(hhmm) ? hhmm : DEFAULT_NUDGE_PREFS.nudgeLocalTime;
  const [h, m] = safe.split(':').map(Number);
  const span = 24 * 60;
  const total = (((h * 60 + m + deltaMinutes) % span) + span) % span;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Wall-clock parts in a zone. Hour 24 from some engines is midnight. */
export function localClock(ms: number, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return { date: localDate(ms, timeZone), minutes: hour * 60 + Number(get('minute')) };
}

function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  let hour = get('hour');
  let day = get('day');
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUtc = Date.UTC(get('year'), get('month') - 1, day, hour, get('minute'), get('second'));
  return Math.round((asUtc - utcMs) / 60_000);
}

/** The UTC instant when a calendar date shows `HH:MM` in `timeZone`. */
export function zonedTime(isoDate: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const first = zoneOffsetMinutes(guess, timeZone);
  let utc = guess - first * 60_000;
  const second = zoneOffsetMinutes(utc, timeZone);
  if (second !== first) utc = guess - second * 60_000;
  return new Date(utc);
}

function inQuiet(atMinutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return atMinutes >= start && atMinutes < end;
  return atMinutes >= start || atMinutes < end;
}

/**
 * Quiet hours delay a push until the window ends. They do not drop it.
 * Equal start and end means the window is empty.
 */
export function holdUntil(at: Date, quietStart: string, quietEnd: string, timeZone: string): Date {
  const start = minutes(quietStart);
  const end = minutes(quietEnd);
  const clock = localClock(at.getTime(), timeZone);
  if (!inQuiet(clock.minutes, start, end)) return at;
  const endDay = clock.minutes < end ? clock.date : addCalendarDays(clock.date, 1);
  return zonedTime(endDay, quietEnd, timeZone);
}

function dayEligible(enrollments: readonly GoalEnrollment[], date: string, today: string, repsToday: number): boolean {
  const goal = goalForDate(enrollments, date);
  if (!goal || goal.rest || goal.target <= 0) return false;
  if (date === today && repsToday > 0) return false;
  return true;
}

/**
 * The next on-phone daily reminder, or null when the server sends it,
 * the reminder is off, or no upcoming day has a goal.
 * A counted rep or a rest day cancels today. Opening the app after the
 * nudge time still delivers today's reminder once.
 */
export function nextLocalReminder(input: {
  prefs: NudgePrefs;
  timeZone: string;
  signedIn: boolean;
  pushRegistered: boolean;
  enrollments: readonly GoalEnrollment[];
  repsToday: number;
  lastFiredDate: string | null;
  now: number;
}): Date | null {
  if (!input.prefs.dailyNudge) return null;
  if (input.signedIn && input.pushRegistered) return null;
  const clock = localClock(input.now, input.timeZone);
  for (let i = 0; i < 8; i++) {
    const date = addCalendarDays(clock.date, i);
    if (!dayEligible(input.enrollments, date, clock.date, input.repsToday)) continue;
    const slot = holdUntil(zonedTime(date, input.prefs.nudgeLocalTime, input.timeZone), input.prefs.quietStart, input.prefs.quietEnd, input.timeZone);
    if (slot.getTime() > input.now) return slot;
    if (date === clock.date && input.lastFiredDate !== clock.date) {
      return holdUntil(new Date(input.now), input.prefs.quietStart, input.prefs.quietEnd, input.timeZone);
    }
  }
  return null;
}

export interface WeekRanks {
  total: number;
  improvement: number;
  friends: boolean;
}

export interface WeekCardModel {
  title: string;
  weekStart: string;
  reps: number;
  goalDaysHit: number;
  goalDaysScheduled: number;
  ranks: string | null;
  destination: 'league' | 'progress';
}

export function parseRecapRanks(raw: unknown): WeekRanks | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const total = typeof row.totalRank === 'number' ? row.totalRank : Number(row.totalRank);
  const improvement = typeof row.improvementRank === 'number' ? row.improvementRank : Number(row.improvementRank);
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(improvement) || improvement < 1) return null;
  if (typeof row.friends !== 'boolean') return null;
  return { total, improvement, friends: row.friends };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Sunday 00:00 through Monday 12:00 local. The card is the week that contains
 * that Sunday. Ranks need an account and at least one friend.
 */
export function weekCard(input: {
  now: number;
  timeZone: string;
  workouts: readonly Workout[];
  enrollments: readonly GoalEnrollment[];
  signedIn: boolean;
  ranks: WeekRanks | null;
}): WeekCardModel | null {
  const clock = localClock(input.now, input.timeZone);
  const weekday = isoWeekday(clock.date);
  const showing = weekday === 7 || (weekday === 1 && clock.minutes < 12 * 60);
  if (!showing) return null;
  const start = weekday === 7 ? weekStart(clock.date) : weekStart(addCalendarDays(clock.date, -1));
  const end = addCalendarDays(start, 7);
  let reps = 0;
  const byDay = new Map<string, number>();
  for (const workout of input.workouts) {
    const date = workoutDate(workout, input.timeZone);
    if (date < start || date >= end) continue;
    reps += workout.countedReps;
    byDay.set(date, (byDay.get(date) ?? 0) + workout.countedReps);
  }
  let goalDaysHit = 0;
  let goalDaysScheduled = 0;
  for (let i = 0; i < 7; i++) {
    const date = addCalendarDays(start, i);
    const goal = goalForDate(input.enrollments, date);
    if (!goal || goal.target <= 0) continue;
    goalDaysScheduled += 1;
    if (date <= clock.date && (byDay.get(date) ?? 0) >= goal.target) goalDaysHit += 1;
  }
  const ranks =
    input.signedIn && input.ranks?.friends
      ? `${ordinal(input.ranks.total)} on total, ${ordinal(input.ranks.improvement)} on improvement`
      : null;
  return {
    title: weekday === 1 ? 'Last week' : 'This week',
    weekStart: start,
    reps,
    goalDaysHit,
    goalDaysScheduled,
    ranks,
    destination: input.signedIn ? 'league' : 'progress',
  };
}

export function weekCardLine(card: WeekCardModel): string {
  const days = card.goalDaysScheduled > 0 ? `${card.goalDaysHit}/${card.goalDaysScheduled} goal days` : `${card.goalDaysHit} goal days`;
  return `${card.reps} push-ups · ${days}`;
}
