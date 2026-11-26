/**
 * All sets (frame 15, E7): sets grouped by day and the Week / Month / Year chart.
 * Pure (no React), unit-tested in __tests__/allSets.test.ts.
 */
import type { SessionRecord } from '../storage/history';
import { addCalendarDays, addMonths, calendarDaysBetween, localDate, monthStart, weekStart } from './calendar';
import { formatClockTime, formatFriendlyDay } from './format';

type SetRow = Pick<SessionRecord, 'id' | 'startedAt' | 'summary'>;

export interface DayGroup<R extends SetRow = SetRow> {
  date: string;
  label: string;
  total: number;
  rows: { record: R; reps: number; time: string; best: boolean }[];
}

/** The id of the best set (most reps; the earlier one wins a tie). */
export function bestSetId(records: readonly SetRow[]): string | null {
  let best: SetRow | null = null;
  for (const r of records) {
    if (r.summary.totalReps <= 0) continue;
    if (!best || r.summary.totalReps > best.summary.totalReps || (r.summary.totalReps === best.summary.totalReps && r.startedAt < best.startedAt))
      best = r;
  }
  return best?.id ?? null;
}

/** Newest day first; within a day, newest set first. The day total is the sum of its sets. */
export function groupByDay<R extends SetRow>(records: readonly R[], nowMs: number, timeZone: string): DayGroup<R>[] {
  const best = bestSetId(records);
  const byDate = new Map<string, R[]>();
  for (const r of records) {
    const d = localDate(r.startedAt, timeZone);
    byDate.set(d, [...(byDate.get(d) ?? []), r]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, rows]) => {
      const sorted = [...rows].sort((a, b) => b.startedAt - a.startedAt);
      return {
        date,
        label: formatFriendlyDay(date, nowMs, timeZone),
        total: sorted.reduce((n, r) => n + r.summary.totalReps, 0),
        rows: sorted.map((r) => ({ record: r, reps: r.summary.totalReps, time: formatClockTime(r.startedAt, timeZone), best: r.id === best })),
      };
    });
}

export type SetRange = 'week' | 'month' | 'year';
export type BarState = 'past' | 'current' | 'future';

export interface RangeChart {
  total: number;
  label: string;
  bars: { key: string; label: string; value: number; state: BarState }[];
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Bars for this week (days), this month (days) or this year (months), with the current one highlighted. */
export function rangeChart(records: readonly SetRow[], range: SetRange, nowMs: number, timeZone: string): RangeChart {
  const today = localDate(nowMs, timeZone);
  const perDay = new Map<string, number>();
  for (const r of records) {
    const d = localDate(r.startedAt, timeZone);
    perDay.set(d, (perDay.get(d) ?? 0) + r.summary.totalReps);
  }
  const state = (key: string, current: string): BarState => (key === current ? 'current' : key < current ? 'past' : 'future');
  let bars: RangeChart['bars'];
  let label: string;
  if (range === 'week') {
    const start = weekStart(today);
    bars = WEEKDAY_LETTERS.map((l, i) => {
      const d = addCalendarDays(start, i);
      return { key: d, label: l, value: perDay.get(d) ?? 0, state: state(d, today) };
    });
    label = 'This week';
  } else if (range === 'month') {
    const start = monthStart(today);
    const days = calendarDaysBetween(start, addMonths(start, 1));
    bars = Array.from({ length: days }, (_, i) => {
      const d = addCalendarDays(start, i);
      const n = i + 1;
      return { key: d, label: n === 1 || n % 7 === 1 ? String(n) : '', value: perDay.get(d) ?? 0, state: state(d, today) };
    });
    label = 'This month';
  } else {
    const year = today.slice(0, 4);
    const month = today.slice(0, 7);
    bars = MONTH_LETTERS.map((l, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      let value = 0;
      for (const [d, n] of perDay) if (d.startsWith(key)) value += n;
      return { key, label: l, value, state: state(key, month) };
    });
    label = 'This year';
  }
  return { total: bars.reduce((n, b) => n + b.value, 0), label, bars };
}
