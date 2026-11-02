import { median } from '../core';
import { addCalendarDays, calendarDaysBetween, monthStart, weekStart, weekdayName } from './calendar';
import { DayGoal, GoalEnrollment, goalForDate } from './goals';
import { Workout, countsForStreak, workoutDate } from './workouts';

const USUAL_WEEKS = 8;
const USUAL_MIN = 3;
const MILESTONES = [1000, 10_000, 100_000] as const;

export interface TodayModel {
  reps: number;
  target: number | null;
  rest: boolean;
  ringText: string;
  ringCaption: string;
  ringProgress: number | null;
  streakLine: string;
  usualLine: string | null;
  travelLine: string | null;
  showSetGoal: boolean;
}

export interface Celebration {
  title: string;
  also?: string;
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

function usualLineFor(workouts: readonly Workout[], enrollments: readonly GoalEnrollment[], today: string, zone: string): string | null {
  const firstSet = earliest(workouts.map((w) => workoutDate(w, zone)));
  const anchor = earliest([firstSet, goalStart(enrollments)]);
  if (!anchor) return null;
  const samples: number[] = [];
  for (let i = 1; i <= USUAL_WEEKS; i++) {
    const date = addCalendarDays(today, -7 * i);
    if (date < anchor) continue;
    samples.push(repsOn(workouts, date, zone, false));
  }
  if (samples.length < USUAL_MIN) return null;
  const delta = repsOn(workouts, today, zone, false) - median(samples);
  const weekday = weekdayName(today);
  if (delta === 0) return `Even with your usual ${weekday}`;
  const abs = Number.isInteger(delta) ? String(Math.abs(delta)) : String(Math.round(Math.abs(delta) * 10) / 10);
  return delta > 0 ? `+${abs} vs your usual ${weekday}` : `−${abs} vs your usual ${weekday}`;
}

function travelLine(workouts: readonly Workout[], zone: string): string | null {
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
  const usualLine = usualLineFor(workouts, enrollments, today, timeZone);
  const travel = travelLine(workouts, timeZone);
  if (!goal) {
    return {
      reps,
      target: null,
      rest: false,
      ringText: String(reps),
      ringCaption: 'Set a goal',
      ringProgress: null,
      streakLine: 'Set a goal to start a streak',
      usualLine,
      travelLine: travel,
      showSetGoal: true,
    };
  }
  if (goal.rest) {
    return {
      reps,
      target: 0,
      rest: true,
      ringText: String(reps),
      ringCaption: 'Rest day',
      ringProgress: null,
      streakLine: `${current} day streak`,
      usualLine,
      travelLine: travel,
      showSetGoal: false,
    };
  }
  const past = reps - goal.target;
  return {
    reps,
    target: goal.target,
    rest: false,
    ringText: `${reps} / ${goal.target}`,
    ringCaption: past > 0 ? `+${past} past your goal` : past === 0 ? 'Goal met' : '',
    ringProgress: Math.max(0, Math.min(1, goal.target === 0 ? 1 : reps / goal.target)),
    streakLine: `${current} day streak`,
    usualLine,
    travelLine: travel,
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

function milestoneTitle(n: number): string {
  return `You crossed ${n.toLocaleString('en-US')} push-ups.`;
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
  const longestBefore = streaks(before, enrollments, today, zone).longest;
  const longestAfter = streaks(workouts, enrollments, today, zone).longest;
  const lifeBefore = lifetime(before);
  const lifeAfter = lifetime(workouts);
  const milestone = crossedMilestone(lifeBefore, lifeAfter);

  let title: string | null = null;
  if (milestone) title = milestoneTitle(milestone);
  else if (longestAfter > longestBefore) title = `New longest streak: ${longestAfter} day streak.`;
  else if (set.countedReps > bestSetReps(before)) title = `New best set: ${set.countedReps}.`;
  else if (bucketMax(workouts, zone, (d) => d) > bucketMax(before, zone, (d) => d)) title = `New best day: ${bucketMax(workouts, zone, (d) => d)}.`;
  else if (bucketMax(workouts, zone, weekStart) > bucketMax(before, zone, weekStart)) title = `New best week: ${bucketMax(workouts, zone, weekStart)}.`;
  else if (bucketMax(workouts, zone, monthStart) > bucketMax(before, zone, monthStart)) title = `New best month: ${bucketMax(workouts, zone, monthStart)}.`;
  else if (goalNewlyMet) title = 'Goal met.';
  else if (goal?.setMarker != null && set.countedReps >= goal.setMarker) title = `${goal.setMarker} in one set.`;

  if (!title) return null;
  if (goalNewlyMet && title !== 'Goal met.') return { title, also: 'Also: goal met.' };
  return { title };
}

export function contributionFor(workouts: readonly Workout[], enrollments: readonly GoalEnrollment[], today: string, zone: string): string {
  const view = buildToday({ workouts, enrollments, today, timeZone: zone });
  return contributionLine(view.reps, view.target, view.rest);
}
