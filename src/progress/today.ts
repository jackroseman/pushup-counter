import { addCalendarDays, calendarDaysBetween, monthStart, weekStart } from './calendar';
import { DayGoal, GoalEnrollment, goalForDate } from './goals';
import { Workout, countsForStreak, workoutDate } from './workouts';

const MILESTONES = [1000, 10_000, 100_000] as const;

export interface TodayModel {
  reps: number;
  target: number | null;
  rest: boolean;
  ringText: string;
  ringCaption: string;
  ringProgress: number | null;
  streakLine: string;
  toGoLine: string | null;
  travelLine: string | null;
  showSetGoal: boolean;
}

export type CelebrationKind =
  | 'first_set'
  | 'milestone'
  | 'longest_streak'
  | 'best_set'
  | 'best_day'
  | 'best_week'
  | 'best_month'
  | 'goal_met'
  | 'set_marker';

export interface Celebration {
  kind: CelebrationKind;
  value?: number;
  goalMet?: boolean;
}

function repsOn(workouts: readonly Workout[], date: string, zone: string, streakOnly: boolean): number {
  return workouts.reduce((sum, w) => {
    if (streakOnly && !countsForStreak(w)) return sum;
    return workoutDate(w, zone) === date ? sum + w.countedReps : sum;
  }, 0);
}

function earliest(values: readonly (string | null | undefined)[]): string | null {
  const present = values.filter((v): v is string => !!v).sort();
  return present[0] ?? null;
}

function goalStart(enrollments: readonly GoalEnrollment[]): string | null {
  return earliest(enrollments.map((e) => e.startedOn));
}

export function streaks(
  workouts: readonly Workout[],
  enrollments: readonly GoalEnrollment[],
  today: string,
  zone: string,
): { current: number; longest: number } {
  const start = goalStart(enrollments);
  if (!start || today < start) return { current: 0, longest: 0 };

  const met = (date: string, goal: DayGoal) => repsOn(workouts, date, zone, true) >= goal.target && goal.target > 0;

  let run = 0;
  let longest = 0;
  const span = calendarDaysBetween(start, today);
  for (let i = 0; i <= span; i++) {
    const date = addCalendarDays(start, i);
    const goal = goalForDate(enrollments, date);
    if (!goal) {
      run = 0;
      continue;
    }
    if (goal.rest) continue;
    if (met(date, goal)) {
      run += 1;
      longest = Math.max(longest, run);
      continue;
    }
    if (date === today) continue;
    run = 0;
  }

  let current = 0;
  for (let i = 0; i <= span; i++) {
    const date = addCalendarDays(today, -i);
    if (date < start) break;
    const goal = goalForDate(enrollments, date);
    if (!goal) break;
    if (date === today && !goal.rest && !met(date, goal)) continue;
    if (goal.rest) continue;
    if (met(date, goal)) {
      current += 1;
      continue;
    }
    break;
  }
  return { current, longest };
}

export function travelLine(workouts: readonly Workout[], zone: string): string | null {
  const newest = [...workouts].sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!newest?.timeZone || newest.timeZone === zone) return null;
  return "Yesterday's workout stays on yesterday at home.";
}

export function buildToday(input: {
  workouts: readonly Workout[];
  enrollments: readonly GoalEnrollment[];
  today: string;
  timeZone: string;
}): TodayModel {
  const { workouts, enrollments, today, timeZone } = input;
  const goal = goalForDate(enrollments, today);
  const reps = repsOn(workouts, today, timeZone, false);
  const { current } = streaks(workouts, enrollments, today, timeZone);
  return presentToday({
    reps,
    target: goal ? goal.target : null,
    rest: goal?.rest ?? false,
    currentStreak: current,
    travelLine: travelLine(workouts, timeZone),
  });
}

/** The ring, caption, and streak line. The phone and `my_progress` both end here. */
export function presentToday(input: {
  reps: number;
  target: number | null;
  rest: boolean;
  currentStreak: number;
  travelLine: string | null;
}): TodayModel {
  const { reps, target, rest, currentStreak, travelLine } = input;
  if (target == null) {
    return {
      reps,
      target: null,
      rest: false,
      ringText: String(reps),
      ringCaption: 'Set a goal',
      ringProgress: null,
      streakLine: 'Set a goal to start a streak',
      toGoLine: null,
      travelLine,
      showSetGoal: true,
    };
  }
  if (rest) {
    return {
      reps,
      target: 0,
      rest: true,
      ringText: String(reps),
      ringCaption: 'Rest day',
      ringProgress: null,
      streakLine: `${currentStreak} day streak`,
      toGoLine: null,
      travelLine,
      showSetGoal: false,
    };
  }
  const past = reps - target;
  return {
    reps,
    target,
    rest: false,
    ringText: `${reps} / ${target}`,
    ringCaption: past > 0 ? `+${past} past your goal` : past === 0 ? 'Goal met' : '',
    ringProgress: Math.max(0, Math.min(1, target === 0 ? 1 : reps / target)),
    streakLine: `${currentStreak} day streak`,
    toGoLine: past < 0 ? `${target - reps} to go` : null,
    travelLine,
    showSetGoal: false,
  };
}

export function contributionLine(repsToday: number, target: number | null, rest: boolean): string {
  if (rest) return `This set put you at ${repsToday}. Rest day.`;
  if (target == null) return `This set put you at ${repsToday} today.`;
  return `This set put you at ${repsToday} / ${target}.`;
}

function lifetime(workouts: readonly Workout[]): number {
  return workouts.reduce((sum, w) => sum + w.countedReps, 0);
}

function crossedMilestone(before: number, after: number): number | null {
  let hit: number | null = null;
  for (const m of MILESTONES) {
    if (before < m && after >= m) hit = m;
  }
  return hit;
}

function bucketMax(workouts: readonly Workout[], zone: string, bucket: (date: string) => string): number {
  const totals = new Map<string, number>();
  for (const w of workouts) {
    const key = bucket(workoutDate(w, zone));
    totals.set(key, (totals.get(key) ?? 0) + w.countedReps);
  }
  return Math.max(0, ...totals.values());
}

function bestSetReps(workouts: readonly Workout[]): number {
  return workouts.reduce((max, w) => Math.max(max, w.countedReps), 0);
}

export function celebrate(
  workouts: readonly Workout[],
  enrollments: readonly GoalEnrollment[],
  today: string,
  zone: string,
  setId: string,
): Celebration | null {
  const set = workouts.find((w) => w.id === setId);
  if (!set) return null;
  const before = workouts.filter((w) => w.id !== setId);
  const goal = goalForDate(enrollments, today);
  const repsBefore = before.reduce((sum, w) => (workoutDate(w, zone) === today ? sum + w.countedReps : sum), 0);
  const repsAfter = repsBefore + (workoutDate(set, zone) === today ? set.countedReps : 0);
  const goalNewlyMet = !!goal && goal.target > 0 && repsBefore < goal.target && repsAfter >= goal.target;

  if (before.length === 0) {
    if (set.countedReps <= 0) return null;
    return goalNewlyMet ? { kind: 'first_set', goalMet: true } : { kind: 'first_set' };
  }

  const longestBefore = streaks(before, enrollments, today, zone).longest;
  const longestAfter = streaks(workouts, enrollments, today, zone).longest;
  const lifeBefore = lifetime(before);
  const lifeAfter = lifetime(workouts);
  const milestone = crossedMilestone(lifeBefore, lifeAfter);

  let result: Celebration | null = null;
  if (milestone) {
    result = { kind: 'milestone', value: milestone };
  } else if (longestAfter > longestBefore) {
    result = { kind: 'longest_streak', value: longestAfter };
  } else if (set.countedReps > bestSetReps(before)) {
    result = { kind: 'best_set', value: set.countedReps };
  } else {
    const dayAfter = bucketMax(workouts, zone, (d) => d);
    if (dayAfter > bucketMax(before, zone, (d) => d)) {
      result = { kind: 'best_day', value: dayAfter };
    } else {
      const weekAfter = bucketMax(workouts, zone, weekStart);
      if (weekAfter > bucketMax(before, zone, weekStart)) {
        result = { kind: 'best_week', value: weekAfter };
      } else {
        const monthAfter = bucketMax(workouts, zone, monthStart);
        if (monthAfter > bucketMax(before, zone, monthStart)) {
          result = { kind: 'best_month', value: monthAfter };
        } else if (goalNewlyMet) {
          result = { kind: 'goal_met', value: goal!.target };
        } else if (goal?.setMarker != null && set.countedReps >= goal.setMarker) {
          result = { kind: 'set_marker', value: goal.setMarker };
        }
      }
    }
  }

  if (!result) return null;
  if (goalNewlyMet && result.kind !== 'goal_met') return { ...result, goalMet: true };
  return result;
}

export function celebrationText(c: Celebration): { title: string; also?: string } {
  let title: string;
  switch (c.kind) {
    case 'first_set':
      title = 'First set';
      break;
    case 'milestone':
      title = `You crossed ${(c.value ?? 0).toLocaleString('en-US')} push-ups.`;
      break;
    case 'longest_streak':
      title = `New longest streak: ${c.value} day streak.`;
      break;
    case 'best_set':
      title = `New best set: ${c.value}.`;
      break;
    case 'best_day':
      title = `New best day: ${c.value}.`;
      break;
    case 'best_week':
      title = `New best week: ${c.value}.`;
      break;
    case 'best_month':
      title = `New best month: ${c.value}.`;
      break;
    case 'goal_met':
      title = 'Goal met.';
      break;
    case 'set_marker':
      title = `${c.value} in one set.`;
      break;
  }
  return c.goalMet && c.kind !== 'goal_met' ? { title, also: 'Also: goal met.' } : { title };
}

export function contributionFor(workouts: readonly Workout[], enrollments: readonly GoalEnrollment[], today: string, zone: string): string {
  const view = buildToday({ workouts, enrollments, today, timeZone: zone });
  return contributionLine(view.reps, view.target, view.rest);
}
