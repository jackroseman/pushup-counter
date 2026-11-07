import { KeyValueStore } from '../storage/history';
import { addCalendarDays, calendarDaysBetween, isoWeekday } from './calendar';
import { CUSTOM_GOAL, Program, ProgramId, programById, segmentForDay } from './programs';
import { Workout, workoutDate } from './workouts';

export const GOAL_KEY = 'pushupcounter.goal.v1';

export interface GoalEnrollment {
  id: string;
  programId: ProgramId | null;
  customDailyReps: number | null;
  startedOn: string;
  /** Exclusive. Null while this is the open goal. */
  endedOn: string | null;
  recordedTimeZone: string;
}

export type GoalChoice = { programId: ProgramId } | { customDailyReps: number };

export type SaveResult = { ok: true; enrollments: GoalEnrollment[] } | { ok: false; message: string };

export interface DayGoal {
  enrollmentId: string;
  programId: ProgramId | null;
  target: number;
  rest: boolean;
  setMarker: number | null;
  customDailyReps: number | null;
}

export function saveEnrollment(
  enrollments: readonly GoalEnrollment[],
  choice: GoalChoice,
  today: string,
  timeZone: string,
  id: string,
): SaveResult {
  if ('customDailyReps' in choice) {
    const n = choice.customDailyReps;
    if (!Number.isInteger(n) || n < CUSTOM_GOAL.min || n > CUSTOM_GOAL.max) {
      return { ok: false, message: `Choose a number from ${CUSTOM_GOAL.min} to ${CUSTOM_GOAL.max}.` };
    }
  }
  const open = [...enrollments].reverse().find((e) => e.endedOn === null);
  const sameDay = open?.startedOn === today;
  const row: GoalEnrollment = {
    id: sameDay && open ? open.id : id,
    programId: 'programId' in choice ? choice.programId : null,
    customDailyReps: 'customDailyReps' in choice ? choice.customDailyReps : null,
    startedOn: sameDay && open ? open.startedOn : today,
    endedOn: null,
    recordedTimeZone: timeZone,
  };
  if (sameDay && open) {
    return { ok: true, enrollments: enrollments.map((e) => (e.id === open.id ? row : e)) };
  }
  const closed = enrollments.map((e) => (e.endedOn === null ? { ...e, endedOn: today } : e));
  return { ok: true, enrollments: [...closed, row] };
}

export function goalForDate(enrollments: readonly GoalEnrollment[], date: string): DayGoal | null {
  const matches = enrollments.filter((e) => e.startedOn <= date && (e.endedOn === null || date < e.endedOn));
  const row = matches.sort((a, b) => (a.startedOn < b.startedOn ? 1 : -1))[0];
  if (!row) return null;
  if (row.customDailyReps != null && row.programId == null) {
    return {
      enrollmentId: row.id,
      programId: null,
      target: row.customDailyReps,
      rest: false,
      setMarker: null,
      customDailyReps: row.customDailyReps,
    };
  }
  const program = programById(row.programId);
  if (!program || row.programId == null) return null;
  const dayNumber = calendarDaysBetween(row.startedOn, date) + 1;
  const seg = segmentForDay(program, dayNumber);
  if (!seg) return null;
  const rest = seg.restWeekday != null && isoWeekday(date) === seg.restWeekday;
  return {
    enrollmentId: row.id,
    programId: row.programId,
    target: rest ? 0 : seg.dailyTarget,
    rest,
    setMarker: rest ? null : seg.setMarker,
    customDailyReps: null,
  };
}

export function programComplete(
  program: Program,
  enrollment: GoalEnrollment,
  workouts: readonly Workout[],
  zone: string,
  today: string,
): boolean {
  if (enrollment.programId !== program.id) return false;
  if (program.completionRule === 'single_set') {
    const need = program.completionSetReps ?? Number.POSITIVE_INFINITY;
    return workouts.some((w) => {
      const date = workoutDate(w, zone);
      return date >= enrollment.startedOn && (enrollment.endedOn === null || date < enrollment.endedOn) && w.countedReps >= need;
    });
  }
  const lastDay = program.segments[program.segments.length - 1].dayTo;
  const rampEnd = addCalendarDays(enrollment.startedOn, lastDay - 1);
  if (enrollment.endedOn !== null && !(rampEnd < enrollment.endedOn)) return false;
  return today > rampEnd;
}

function isProgramId(v: unknown): v is ProgramId {
  return v === 'first_20' || v === 'fifty_a_day' || v === 'hundred_in_30';
}

function sanitizeEnrollment(raw: unknown): GoalEnrollment | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const programId = o.programId == null ? null : isProgramId(o.programId) ? o.programId : null;
  const custom = typeof o.customDailyReps === 'number' && Number.isInteger(o.customDailyReps) ? o.customDailyReps : null;
  if ((programId == null) === (custom == null)) return null;
  if (typeof o.id !== 'string' || typeof o.startedOn !== 'string' || typeof o.recordedTimeZone !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.startedOn)) return null;
  const endedOn = o.endedOn == null ? null : typeof o.endedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.endedOn) ? o.endedOn : null;
  if (o.endedOn != null && endedOn == null) return null;
  if (custom != null && (custom < 1 || custom > 2000)) return null;
  return { id: o.id, programId, customDailyReps: custom, startedOn: o.startedOn, endedOn, recordedTimeZone: o.recordedTimeZone };
}

export async function loadGoal(kv: KeyValueStore): Promise<GoalEnrollment[]> {
  try {
    const raw = await kv.getItem(GOAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeEnrollment).filter((e): e is GoalEnrollment => e !== null);
  } catch {
    return [];
  }
}

export async function saveGoal(kv: KeyValueStore, enrollments: readonly GoalEnrollment[]): Promise<void> {
  await kv.setItem(GOAL_KEY, JSON.stringify(enrollments));
}
