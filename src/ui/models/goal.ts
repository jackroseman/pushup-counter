/**
 * Goal picker and goal sheet rules (frames 2 and 5). Pure: no React, no I/O.
 * Program numbers come from `progress/programs.ts`; only the card copy lives here.
 */
import { calendarDaysBetween } from '../../progress/calendar';
import type { GoalEnrollment } from '../../progress/goals';
import { PROGRAMS, type Program, type ProgramId, programById, segmentForDay } from '../../progress/programs';

/** Card copy from frame 2 (plain, no schedule detail). */
const CARD_COPY: Record<ProgramId, { title: string; summary: string }> = {
  first_20: { title: 'First 20 in a row', summary: 'Build to 20 reps in one set' },
  fifty_a_day: { title: '50 a day', summary: 'Work up to 50 reps a day' },
  hundred_in_30: { title: '100 a day', summary: 'Reach 100 reps a day' },
};

/** The middle option is picked when a new user lands on frame 2. */
export const DEFAULT_PROGRAM: ProgramId = 'fifty_a_day';

export interface GoalBar {
  /** 0–1 of the tallest week. */
  height: number;
  current: boolean;
}

export interface ProgramCard {
  id: ProgramId;
  title: string;
  summary: string;
  length: string;
  bars: GoalBar[];
}

/** One bar per week of the program, scaled to its last week. */
export function programBars(program: Program, currentWeek: number | null = null): GoalBar[] {
  const max = Math.max(...program.segments.map((s) => s.dailyTarget));
  return program.segments.map((s, i) => ({ height: max > 0 ? s.dailyTarget / max : 0, current: currentWeek === i + 1 }));
}

export function programCards(): ProgramCard[] {
  return PROGRAMS.map((p) => ({ id: p.id, ...CARD_COPY[p.id], length: p.lengthLabel, bars: programBars(p) }));
}

export function openEnrollment(enrollments: readonly GoalEnrollment[]): GoalEnrollment | null {
  return [...enrollments].reverse().find((e) => e.endedOn === null) ?? null;
}

export type GoalSummary =
  | { kind: 'program'; programId: ProgramId; title: string; detail: string; bars: GoalBar[]; dailyTarget: number }
  | { kind: 'custom'; title: string; detail: string; dailyTarget: number };

/** The current goal at the top of the sheet (frame 5), or null with no goal. */
export function goalSummary(enrollments: readonly GoalEnrollment[], today: string): GoalSummary | null {
  const open = openEnrollment(enrollments);
  if (!open) return null;
  const program = programById(open.programId);
  if (!program) {
    const n = open.customDailyReps;
    return n ? { kind: 'custom', title: `${n} a day`, detail: 'Every day', dailyTarget: n } : null;
  }
  const day = Math.max(1, calendarDaysBetween(open.startedOn, today) + 1);
  const seg = segmentForDay(program, day) ?? program.segments[program.segments.length - 1];
  const weeks = program.segments.length;
  const last = program.segments[weeks - 1];
  const week = program.segments.indexOf(seg) + 1;
  const head = day > last.dayTo ? 'Program done' : `Week ${week} of ${weeks}`;
  const rest = seg.restWeekday === 7 ? ' · Sundays off' : '';
  return {
    kind: 'program',
    programId: program.id,
    title: CARD_COPY[program.id].title,
    detail: `${head}${rest}`,
    bars: programBars(program, day > last.dayTo ? null : week),
    dailyTarget: seg.dailyTarget,
  };
}
