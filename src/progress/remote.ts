import { weekdayName } from './calendar';
import { GoalChoice, GoalEnrollment } from './goals';
import { buildProgress, ProgressModel } from './progress';
import { buildToday, formatUsual, presentToday, travelLine, TodayModel } from './today';
import { countsForStreak, Workout } from './workouts';
import type { ProgramId } from './programs';

export const OLDER_SETS_NOTE = 'Older sets are in your charts.';
export const REFRESH_FAILED = "Couldn't refresh.";
export const SYNCED_LATE = 'Synced late. It counts in your totals, not in your streak.';
export const OLD_SETS_NOTE = "Sets older than 60 days still count toward your records. They don't rebuild a streak.";
export const GOAL_SYNC_KEY = 'pushupcounter.goalSync.v1';

export interface ServerSet {
  clientSetId: string;
  startedAt: number;
  timeZone: string;
  countedReps: number;
  receivedAt: number;
}

export interface ServerEnrollment {
  id: string;
  programId: ProgramId | null;
  customDailyReps: number | null;
  startedOn: string;
  endedOn: string | null;
  recordedTimeZone: string;
  createdAt?: string;
}

export interface ServerProgress {
  timeZone: string;
  today: string;
  todayReps: number;
  target: number | null;
  rest: boolean;
  goalMet: boolean;
  usual: number | null;
  delta: number | null;
  currentStreak: number;
  longestStreak: number;
  lifetimeReps: number;
  badges: { milestone: number; earnedOn: string | null; remaining: number | null }[];
  records: {
    bestSet: { reps: number; date: string } | null;
    bestDay: { reps: number; date: string } | null;
    bestWeek: { reps: number; date: string } | null;
    bestMonth: { reps: number; date: string } | null;
  };
  charts: {
    day: { date: string; reps: number; target: number | null }[];
    week: { start: string; reps: number }[];
    month: { start: string; reps: number }[];
    lifetime: { weekStart: string; total: number }[];
  };
  program: { status: 'not_started' | 'in_progress' | 'complete'; name: string; detail: string };
  enrollments: ServerEnrollment[];
  sets: ServerSet[];
}

export interface GoalSnapshot {
  id: string;
  programId: ProgramId | null;
  customDailyReps: number | null;
  startedOn: string;
}

export interface GoalSyncState {
  userId: string;
  pending: GoalChoice | null;
  basedOn: GoalSnapshot | null;
  settled: boolean;
}

export type GoalSyncAction = { type: 'none' } | { type: 'adopt' } | { type: 'upload'; choice: GoalChoice } | { type: 'clear' };

const DATE = /^\d{4}-\d{2}-\d{2}/;

function asDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  return value.slice(0, 10);
}

function asInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asProgram(value: unknown): ProgramId | null {
  return value === 'first_20' || value === 'fifty_a_day' || value === 'hundred_in_30' ? value : null;
}

function recordOf(value: unknown): { reps: number; date: string } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { reps?: unknown; date?: unknown };
  const reps = asInt(row.reps);
  const date = asDate(row.date);
  if (reps == null || date == null) return null;
  return { reps, date };
}

export function parseServerProgress(raw: unknown): ServerProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const today = asDate(doc.today);
  const timeZone = typeof doc.timeZone === 'string' ? doc.timeZone : null;
  const charts = doc.charts as ServerProgress['charts'] | undefined;
  const records = doc.records as ServerProgress['records'] | undefined;
  const program = doc.program as ServerProgress['program'] | undefined;
  if (!today || !timeZone || !charts || !records || !program || !Array.isArray(doc.sets) || !Array.isArray(doc.enrollments)) return null;
  if (!Array.isArray(charts.day) || !Array.isArray(charts.week) || !Array.isArray(charts.month) || !Array.isArray(charts.lifetime)) return null;
  const sets: ServerSet[] = [];
  for (const item of doc.sets) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const startedAt = typeof row.startedAt === 'number' ? row.startedAt : Number(row.startedAt);
    const receivedAt = typeof row.receivedAt === 'number' ? row.receivedAt : Number(row.receivedAt);
    const counted = asInt(row.countedReps);
    if (typeof row.clientSetId !== 'string' || !Number.isFinite(startedAt) || !Number.isFinite(receivedAt) || counted == null) continue;
    sets.push({
      clientSetId: row.clientSetId,
      startedAt,
      receivedAt,
      countedReps: counted,
      timeZone: typeof row.timeZone === 'string' ? row.timeZone : timeZone,
    });
  }
  const enrollments: ServerEnrollment[] = [];
  for (const item of doc.enrollments) {
    const row = enrollmentFrom(item);
    if (row) enrollments.push(row);
  }
  const badges = Array.isArray(doc.badges)
    ? doc.badges.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as { milestone?: unknown; earnedOn?: unknown; remaining?: unknown };
        const milestone = asInt(row.milestone);
        if (milestone == null) return [];
        return [{ milestone, earnedOn: asDate(row.earnedOn), remaining: row.remaining == null ? null : asInt(row.remaining) }];
      })
    : [];
  return {
    timeZone,
    today,
    todayReps: asInt(doc.todayReps) ?? 0,
    target: doc.target == null ? null : asInt(doc.target),
    rest: doc.rest === true,
    goalMet: doc.goalMet === true,
    usual: typeof doc.usual === 'number' ? doc.usual : null,
    delta: typeof doc.delta === 'number' ? doc.delta : null,
    currentStreak: asInt(doc.currentStreak) ?? 0,
    longestStreak: asInt(doc.longestStreak) ?? 0,
    lifetimeReps: asInt(doc.lifetimeReps) ?? 0,
    badges,
    records: {
      bestSet: recordOf(records.bestSet),
      bestDay: recordOf(records.bestDay),
      bestWeek: recordOf(records.bestWeek),
      bestMonth: recordOf(records.bestMonth),
    },
    charts: {
      day: charts.day.map((bucket) => ({
        date: asDate(bucket.date) ?? today,
        reps: asInt(bucket.reps) ?? 0,
        target: bucket.target == null ? null : asInt(bucket.target),
      })),
      week: charts.week.map((bucket) => ({ start: asDate(bucket.start) ?? today, reps: asInt(bucket.reps) ?? 0 })),
      month: charts.month.map((bucket) => ({ start: asDate(bucket.start) ?? today, reps: asInt(bucket.reps) ?? 0 })),
      lifetime: charts.lifetime.map((point) => ({ weekStart: asDate(point.weekStart) ?? today, total: asInt(point.total) ?? 0 })),
    },
    program: {
      status: program.status === 'complete' || program.status === 'in_progress' ? program.status : 'not_started',
      name: typeof program.name === 'string' ? program.name : 'Program',
      detail: typeof program.detail === 'string' ? program.detail : 'Not started',
    },
    enrollments,
    sets,
  };
}

function enrollmentFrom(raw: unknown): ServerEnrollment | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : null;
  const startedOn = asDate(row.startedOn);
  const recordedTimeZone = typeof row.recordedTimeZone === 'string' ? row.recordedTimeZone : null;
  const programId = row.programId == null ? null : asProgram(row.programId);
  const custom = asInt(row.customDailyReps);
  if (!id || !startedOn || !recordedTimeZone) return null;
  if ((programId == null) === (custom == null)) return null;
  return {
    id,
    programId,
    customDailyReps: custom,
    startedOn,
    endedOn: row.endedOn == null ? null : asDate(row.endedOn),
    recordedTimeZone,
    ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
  };
}

export function workoutsFromServer(sets: readonly ServerSet[]): Workout[] {
  return sets.map((set) => ({
    id: set.clientSetId,
    startedAt: set.startedAt,
    timeZone: set.timeZone,
    countedReps: set.countedReps,
    receivedAt: set.receivedAt,
  }));
}

export function enrollmentsFromServer(rows: readonly ServerEnrollment[]): GoalEnrollment[] {
  return rows.map((row) => ({
    id: row.id,
    programId: row.programId,
    customDailyReps: row.customDailyReps,
    startedOn: row.startedOn,
    endedOn: row.endedOn,
    recordedTimeZone: row.recordedTimeZone,
  }));
}

/** Server sets, plus any set still only on this phone. A shared id is counted once. */
export function mergeWorkouts(serverSets: readonly ServerSet[], local: readonly Workout[]): { workouts: Workout[]; unsynced: boolean } {
  const server = workoutsFromServer(serverSets);
  const ids = new Set(server.map((workout) => workout.id));
  const extra = local.filter((workout) => !ids.has(workout.id));
  return { workouts: [...server, ...extra], unsynced: extra.length > 0 };
}

export function todayFromServer(doc: ServerProgress, workouts: readonly Workout[]): TodayModel {
  const delta = doc.delta;
  return presentToday({
    reps: doc.todayReps,
    target: doc.rest ? 0 : doc.target,
    rest: doc.rest,
    currentStreak: doc.currentStreak,
    usualLine: delta == null ? null : formatUsual(delta, weekdayName(doc.today)),
    travelLine: travelLine(workouts, doc.timeZone),
  });
}

export function progressFromServer(doc: ServerProgress, phoneSetCount: number): ProgressModel {
  return {
    empty: doc.sets.length === 0,
    day: doc.charts.day,
    week: doc.charts.week,
    month: doc.charts.month,
    lifetime: doc.charts.lifetime,
    bestSet: doc.records.bestSet,
    bestDay: doc.records.bestDay,
    bestWeek: doc.records.bestWeek,
    bestMonth: doc.records.bestMonth,
    longestStreak: doc.longestStreak,
    streakIsNow: doc.currentStreak > 0 && doc.currentStreak === doc.longestStreak,
    badges: doc.badges,
    program: doc.program,
    historyNote: doc.sets.length > phoneSetCount ? OLDER_SETS_NOTE : null,
  };
}

/** Phone math for the sets the server has not received yet, on top of the server sets. */
export function progressWithUnsynced(doc: ServerProgress, local: readonly Workout[]): { today: TodayModel; progress: ProgressModel } {
  const { workouts } = mergeWorkouts(doc.sets, local);
  const enrollments = enrollmentsFromServer(doc.enrollments);
  const today = buildToday({ workouts, enrollments, today: doc.today, timeZone: doc.timeZone });
  const progress = buildProgress({ workouts, enrollments, today: doc.today, timeZone: doc.timeZone, storedCount: 0 });
  return {
    today,
    progress: { ...progress, historyNote: doc.sets.length > local.length ? OLDER_SETS_NOTE : null },
  };
}

export function lateSetIds(sets: readonly ServerSet[]): string[] {
  return sets
    .filter((set) => !countsForStreak({ id: set.clientSetId, startedAt: set.startedAt, countedReps: set.countedReps, receivedAt: set.receivedAt }))
    .map((set) => set.clientSetId);
}

export function goalSnapshot(row: { id: string; programId: ProgramId | null; customDailyReps: number | null; startedOn: string } | null): GoalSnapshot | null {
  if (!row) return null;
  return { id: row.id, programId: row.programId, customDailyReps: row.customDailyReps, startedOn: row.startedOn };
}

export function sameSnapshot(a: GoalSnapshot | null, b: GoalSnapshot | null): boolean {
  if (a == null || b == null) return a === b;
  return a.id === b.id && a.programId === b.programId && a.customDailyReps === b.customDailyReps && a.startedOn === b.startedOn;
}

export function openChoice(enrollments: readonly GoalEnrollment[]): GoalChoice | null {
  const open = [...enrollments].reverse().find((row) => row.endedOn === null);
  if (!open) return null;
  return open.programId ? { programId: open.programId } : { customDailyReps: open.customDailyReps ?? 0 };
}

export function freshGoalSync(userId: string): GoalSyncState {
  return { userId, pending: null, basedOn: null, settled: false };
}

/**
 * The server row wins when this account already has one, or when it changed after
 * this phone saved. A local goal uploads only when the server has no enrollment
 * and this sign-in has not settled yet. A pending edit uploads when the open
 * enrollment still matches the snapshot it was based on.
 */
export function decideGoalSync(input: {
  userId: string;
  local: readonly GoalEnrollment[];
  server: readonly ServerEnrollment[];
  sync: GoalSyncState | null;
}): { action: GoalSyncAction; next: GoalSyncState } {
  const serverOpen = [...input.server].reverse().find((row) => row.endedOn === null) ?? null;
  const serverSnap = goalSnapshot(serverOpen);
  // A different account's goal stays off this one. The server row replaces it, or the phone starts clean.
  if (input.sync && input.sync.userId !== input.userId) {
    if (serverOpen) return { action: { type: 'adopt' }, next: { userId: input.userId, pending: null, basedOn: serverSnap, settled: true } };
    return { action: { type: 'clear' }, next: { userId: input.userId, pending: null, basedOn: null, settled: true } };
  }
  const sync = input.sync ?? freshGoalSync(input.userId);
  if (sync.pending) {
    if (sameSnapshot(sync.basedOn, serverSnap)) return { action: { type: 'upload', choice: sync.pending }, next: sync };
    return { action: { type: 'adopt' }, next: { userId: input.userId, pending: null, basedOn: serverSnap, settled: true } };
  }
  if (serverOpen) return { action: { type: 'adopt' }, next: { userId: input.userId, pending: null, basedOn: serverSnap, settled: true } };
  const localChoice = openChoice(input.local);
  if (!sync.settled && localChoice) {
    return { action: { type: 'upload', choice: localChoice }, next: { userId: input.userId, pending: localChoice, basedOn: null, settled: false } };
  }
  return { action: { type: 'none' }, next: { userId: input.userId, pending: null, basedOn: null, settled: true } };
}

export function queueGoalEdit(userId: string, choice: GoalChoice, basedOn: GoalSnapshot | null): GoalSyncState {
  return { userId, pending: choice, basedOn, settled: false };
}

/** Keep a pending edit from being offered twice in one session after it lands. */
export function goalSyncSettled(userId: string, basedOn: GoalSnapshot | null): GoalSyncState {
  return { userId, pending: null, basedOn, settled: true };
}

export function sanitizeGoalSync(raw: unknown, userId: string): GoalSyncState {
  if (!raw || typeof raw !== 'object') return freshGoalSync(userId);
  const row = raw as Partial<GoalSyncState>;
  if (row.userId !== userId) return freshGoalSync(userId);
  const pending = choiceFrom(row.pending);
  const basedOn = row.basedOn && typeof row.basedOn === 'object' ? goalSnapshot(row.basedOn as GoalSnapshot) : null;
  return { userId, pending, basedOn: basedOn && basedOn.id ? basedOn : null, settled: row.settled === true };
}

function choiceFrom(raw: unknown): GoalChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { programId?: unknown; customDailyReps?: unknown };
  if (asProgram(row.programId)) return { programId: asProgram(row.programId)! };
  const custom = asInt(row.customDailyReps);
  if (custom != null) return { customDailyReps: custom };
  return null;
}

export function signedInViews(doc: ServerProgress, local: readonly Workout[]): { today: TodayModel; progress: ProgressModel; unsynced: boolean } {
  const merged = mergeWorkouts(doc.sets, local);
  if (!merged.unsynced) {
    return { today: todayFromServer(doc, merged.workouts), progress: progressFromServer(doc, local.length), unsynced: false };
  }
  const overlaid = progressWithUnsynced(doc, local);
  return { ...overlaid, unsynced: true };
}
