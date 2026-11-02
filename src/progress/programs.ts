import { addCalendarDays, isoWeekday } from './calendar';

export type ProgramId = 'first_20' | 'fifty_a_day' | 'hundred_in_30';

export interface ProgramSegment {
  dayFrom: number;
  dayTo: number;
  dailyTarget: number;
  /** ISO weekday that is a rest day, or null. 7 is Sunday. */
  restWeekday: number | null;
  /** Celebration threshold for one set. The ring still uses dailyTarget. */
  setMarker: number | null;
}

export interface Program {
  id: ProgramId;
  name: string;
  summary: string;
  completionRule: 'single_set' | 'finish_schedule';
  completionSetReps: number | null;
  maintainsAfter: boolean;
  lengthLabel: string;
  segments: ProgramSegment[];
}

export const CUSTOM_GOAL = { min: 5, max: 500, step: 5, suggested: 30 };

const week = (
  dayFrom: number,
  dailyTarget: number,
  restWeekday: number | null,
  setMarker: number | null,
  days = 7,
): ProgramSegment => ({
  dayFrom,
  dayTo: dayFrom + days - 1,
  dailyTarget,
  restWeekday,
  setMarker,
});

/** Bundled starters. Targets are the seed in the design spec. A different ramp is a new id. */
export const PROGRAMS: readonly Program[] = [
  {
    id: 'first_20',
    name: 'First 20 in a row',
    summary: 'Build to 20 good reps in one set. Sundays off.',
    completionRule: 'single_set',
    completionSetReps: 20,
    maintainsAfter: true,
    lengthLabel: '4 weeks',
    segments: [
      week(1, 10, 7, 5),
      week(8, 15, 7, 10),
      week(15, 20, 7, 15),
      week(22, 25, 7, 20),
    ],
  },
  {
    id: 'fifty_a_day',
    name: '50 a day',
    summary: 'Work up to 50 push-ups a day.',
    completionRule: 'finish_schedule',
    completionSetReps: null,
    maintainsAfter: true,
    lengthLabel: '4 weeks',
    segments: [week(1, 20, null, null), week(8, 30, null, null), week(15, 40, null, null), week(22, 50, null, null)],
  },
  {
    id: 'hundred_in_30',
    name: '100 a day in 30 days',
    summary: 'Reach 100 push-ups a day in 30 days.',
    completionRule: 'finish_schedule',
    completionSetReps: null,
    maintainsAfter: true,
    lengthLabel: '30 days',
    segments: [week(1, 40, null, null), week(8, 55, null, null), week(15, 70, null, null), week(22, 100, null, null, 9)],
  },
];

export function programById(id: string | null | undefined): Program | null {
  return PROGRAMS.find((p) => p.id === id) ?? null;
}

export function segmentForDay(program: Program, dayNumber: number): ProgramSegment | null {
  if (dayNumber < 1) return null;
  const hit = program.segments.find((s) => dayNumber >= s.dayFrom && dayNumber <= s.dayTo);
  if (hit) return hit;
  const last = program.segments[program.segments.length - 1];
  return program.maintainsAfter && dayNumber > last.dayTo ? last : null;
}

export function segmentsCoverRamp(program: Program): boolean {
  let next = 1;
  for (const seg of program.segments) {
    if (seg.dayFrom !== next || seg.dayTo < seg.dayFrom) return false;
    next = seg.dayTo + 1;
  }
  return program.segments.length > 0 && program.segments[0].dayFrom === 1;
}

/** Counted reps if every scheduled day in the ramp is hit, from a start date. */
export function scheduledReps(program: Program, startDate: string): number {
  const last = program.segments[program.segments.length - 1].dayTo;
  let total = 0;
  for (let day = 1; day <= last; day++) {
    const seg = segmentForDay(program, day);
    if (!seg) continue;
    const date = addCalendarDays(startDate, day - 1);
    const rest = seg.restWeekday != null && isoWeekday(date) === seg.restWeekday;
    if (!rest) total += seg.dailyTarget;
  }
  return total;
}

/** What the goal screen shows for the week this day number falls in. */
export function currentTargetLabel(program: Program, dayNumber: number): string {
  const seg = segmentForDay(program, Math.max(1, dayNumber));
  if (!seg) return program.name;
  const last = program.segments[program.segments.length - 1];
  const maintaining = dayNumber > last.dayTo;
  const week = program.segments.indexOf(seg) + 1;
  const head = maintaining ? 'Maintaining' : `Week ${week}`;
  const rest = seg.restWeekday === 7 ? ' · Sunday off' : '';
  return `${head} · ${seg.dailyTarget} a day${rest}`;
}
