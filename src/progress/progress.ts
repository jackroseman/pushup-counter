import { MAX_HISTORY } from '../storage/history';
import { addCalendarDays, addMonths, calendarDaysBetween, monthStart, weekStart } from './calendar';
import { GoalEnrollment, goalForDate, programComplete } from './goals';
import { currentTargetLabel, programById } from './programs';
import { streaks } from './today';
import { Workout, workoutDate } from './workouts';

export const MILESTONES = [1000, 10_000, 100_000] as const;
export const EMPTY_PROGRESS = 'Do a set to start.';
export const STREAK_NOW = "That's now.";
export const HISTORY_CAP_NOTE = 'Showing the last 200 sets on this phone. Sign in to keep the full history.';

const DAY_BARS = 14;
const WEEK_BARS = 12;
const MONTH_BARS = 12;

export interface DayBucket {
  date: string;
  reps: number;
  /** Daily target when a goal covered this date, including 0 on a rest day. Null when there was no goal. */
  target: number | null;
}

export interface PeriodBucket {
  start: string;
  reps: number;
}

export interface LifetimePoint {
  weekStart: string;
  total: number;
}

export interface ShelfRecord {
  reps: number;
  date: string;
}

export interface Badge {
  milestone: number;
  earnedOn: string | null;
  remaining: number | null;
}

export interface ProgramRow {
  status: 'not_started' | 'in_progress' | 'complete';
  name: string;
  detail: string;
}

export interface ProgressModel {
  empty: boolean;
  day: DayBucket[];
  week: PeriodBucket[];
  month: PeriodBucket[];
  lifetime: LifetimePoint[];
  bestSet: ShelfRecord | null;
  bestDay: ShelfRecord | null;
  bestWeek: ShelfRecord | null;
  bestMonth: ShelfRecord | null;
  longestStreak: number;
  streakIsNow: boolean;
  badges: Badge[];
  program: ProgramRow;
  historyNote: string | null;
}

export function formatCount(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Locked badge copy, e.g. `258 to 1,000`. */
export function lockedBadgeText(remaining: number, milestone: number): string {
  return `${formatCount(remaining)} to ${formatCount(milestone)}`;
}

/**
 * Top of a chart axis. The next milestone stays on screen so a small total
 * still shows the line it is climbing toward. Past the last milestone, the
 * axis follows the total.
 */
export function chartCeiling(peak: number, guides: readonly number[]): number {
  const top = Math.max(0, peak);
  const next = guides.find((g) => g >= top);
  return Math.max(top, next ?? 0, 1);
}

function totalsByDate(workouts: readonly Workout[], zone: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const workout of workouts) {
    const date = workoutDate(workout, zone);
    totals.set(date, (totals.get(date) ?? 0) + workout.countedReps);
  }
  return totals;
}

function repsFrom(totals: Map<string, number>, from: string, to: string): number {
  let sum = 0;
  for (const [date, reps] of totals) {
    if (date >= from && date <= to) sum += reps;
  }
  return sum;
}

function richest(buckets: readonly { date: string; reps: number }[]): ShelfRecord | null {
  let best: ShelfRecord | null = null;
  for (const bucket of buckets) {
    if (bucket.reps <= 0) continue;
    if (!best || bucket.reps > best.reps || (bucket.reps === best.reps && bucket.date < best.date)) {
      best = { reps: bucket.reps, date: bucket.date };
    }
  }
  return best;
}

function bestSingleSet(workouts: readonly Workout[], zone: string): ShelfRecord | null {
  let best: (ShelfRecord & { startedAt: number }) | null = null;
  for (const workout of workouts) {
    if (workout.countedReps <= 0) continue;
    const date = workoutDate(workout, zone);
    const earlier =
      best !== null &&
      workout.countedReps === best.reps &&
      (date < best.date || (date === best.date && workout.startedAt < best.startedAt));
    if (!best || workout.countedReps > best.reps || earlier) {
      best = { reps: workout.countedReps, date, startedAt: workout.startedAt };
    }
  }
  return best ? { reps: best.reps, date: best.date } : null;
}

function badgesFor(workouts: readonly Workout[], zone: string): Badge[] {
  const ordered = [...workouts].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const earned = new Map<number, string>();
  let total = 0;
  for (const workout of ordered) {
    const before = total;
    total += workout.countedReps;
    for (const milestone of MILESTONES) {
      if (!earned.has(milestone) && before < milestone && total >= milestone) {
        earned.set(milestone, workoutDate(workout, zone));
      }
    }
  }
  return MILESTONES.map((milestone) => {
    const earnedOn = earned.get(milestone) ?? null;
    return { milestone, earnedOn, remaining: earnedOn ? null : Math.max(0, milestone - total) };
  });
}

function lifetimeSeries(totals: Map<string, number>, today: string): LifetimePoint[] {
  const dates = [...totals.keys()].sort();
  if (dates.length === 0) return [];
  const end = today > dates[dates.length - 1] ? today : dates[dates.length - 1];
  const points: LifetimePoint[] = [];
  let cursor = weekStart(dates[0]);
  const endWeek = weekStart(end);
  let running = 0;
  let guard = 0;
  while (cursor <= endWeek && guard < 2000) {
    running += repsFrom(totals, cursor, addCalendarDays(cursor, 6));
    points.push({ weekStart: cursor, total: running });
    cursor = addCalendarDays(cursor, 7);
    guard += 1;
  }
  return points;
}

function programRow(
  enrollments: readonly GoalEnrollment[],
  workouts: readonly Workout[],
  zone: string,
  today: string,
): ProgramRow {
  const open = [...enrollments].reverse().find((row) => row.endedOn === null);
  if (!open) return { status: 'not_started', name: 'Program', detail: 'Not started' };
  if (!open.programId) {
    const reps = open.customDailyReps;
    return { status: 'in_progress', name: 'Custom goal', detail: reps ? `${reps} a day` : 'Custom goal' };
  }
  const program = programById(open.programId);
  if (!program) return { status: 'in_progress', name: 'Program', detail: 'In progress' };
  if (programComplete(program, open, workouts, zone, today)) {
    return { status: 'complete', name: program.name, detail: 'Complete' };
  }
  const day = Math.max(1, calendarDaysBetween(open.startedOn, today) + 1);
  return { status: 'in_progress', name: program.name, detail: currentTargetLabel(program, day) };
}

export function buildProgress(input: {
  workouts: readonly Workout[];
  enrollments: readonly GoalEnrollment[];
  today: string;
  timeZone: string;
  storedCount: number;
}): ProgressModel {
  const { workouts, enrollments, today, timeZone, storedCount } = input;
  const totals = totalsByDate(workouts, timeZone);
  const thisWeek = weekStart(today);
  const thisMonth = monthStart(today);

  const day: DayBucket[] = [];
  for (let i = DAY_BARS - 1; i >= 0; i--) {
    const date = addCalendarDays(today, -i);
    const goal = goalForDate(enrollments, date);
    day.push({ date, reps: totals.get(date) ?? 0, target: goal ? goal.target : null });
  }

  const week: PeriodBucket[] = [];
  for (let i = WEEK_BARS - 1; i >= 0; i--) {
    const start = addCalendarDays(thisWeek, -7 * i);
    week.push({ start, reps: repsFrom(totals, start, addCalendarDays(start, 6)) });
  }

  const month: PeriodBucket[] = [];
  for (let i = MONTH_BARS - 1; i >= 0; i--) {
    const start = addMonths(thisMonth, -i);
    const end = addCalendarDays(addMonths(start, 1), -1);
    month.push({ start, reps: repsFrom(totals, start, end) });
  }

  const { current, longest } = streaks(workouts, enrollments, today, timeZone);

  return {
    empty: workouts.length === 0,
    day,
    week,
    month,
    lifetime: lifetimeSeries(totals, today),
    bestSet: bestSingleSet(workouts, timeZone),
    bestDay: richest([...totals].map(([date, reps]) => ({ date, reps }))),
    bestWeek: richest(weekBuckets(totals)),
    bestMonth: richest(monthBuckets(totals)),
    longestStreak: longest,
    streakIsNow: current > 0 && current === longest,
    badges: badgesFor(workouts, timeZone),
    program: programRow(enrollments, workouts, timeZone, today),
    historyNote: storedCount >= MAX_HISTORY ? HISTORY_CAP_NOTE : null,
  };
}

function weekBuckets(totals: Map<string, number>): { date: string; reps: number }[] {
  const buckets = new Map<string, number>();
  for (const [date, reps] of totals) {
    const start = weekStart(date);
    buckets.set(start, (buckets.get(start) ?? 0) + reps);
  }
  return [...buckets].map(([date, reps]) => ({ date, reps }));
}

function monthBuckets(totals: Map<string, number>): { date: string; reps: number }[] {
  const buckets = new Map<string, number>();
  for (const [date, reps] of totals) {
    const start = monthStart(date);
    buckets.set(start, (buckets.get(start) ?? 0) + reps);
  }
  return [...buckets].map(([date, reps]) => ({ date, reps }));
}
