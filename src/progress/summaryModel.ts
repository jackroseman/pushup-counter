/**
 * View models for the post-set summary (frame 11, E4) and Set details (frame 12).
 * Pure (no React), unit-tested in __tests__/summaryModel.test.ts.
 */
import { analyzeSet, type Rep, type SetAnalysis } from '../core';
import type { SessionRecord } from '../storage/history';
import type { Celebration, TodayModel } from './today';
import { formatSetDateTime } from './format';

export type BadgeIcon = 'arrowUp' | 'check' | 'flame';

/** m:ss for seconds. */
export function setClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Set length in seconds: Go to End set. */
export function setSeconds(record: Pick<SessionRecord, 'startedAt' | 'endedAt'>): number {
  return Math.max(0, (record.endedAt - record.startedAt) / 1000);
}

/** The one quiet badge over the count ("New best set", "First set"). Goal met shows in the Today card instead. */
export function summaryBadge(c: Celebration | null): { label: string; icon: BadgeIcon } | null {
  if (!c) return null;
  switch (c.kind) {
    case 'first_set':
      return { label: 'First set', icon: 'check' };
    case 'best_set':
      return { label: 'New best set', icon: 'arrowUp' };
    case 'best_day':
      return { label: 'New best day', icon: 'arrowUp' };
    case 'best_week':
      return { label: 'New best week', icon: 'arrowUp' };
    case 'best_month':
      return { label: 'New best month', icon: 'arrowUp' };
    case 'longest_streak':
      return { label: 'Longest streak', icon: 'flame' };
    case 'milestone':
      return { label: `${(c.value ?? 0).toLocaleString('en-US')} push-ups`, icon: 'check' };
    case 'set_marker':
      return { label: `${c.value} in one set`, icon: 'check' };
    case 'goal_met':
      return null;
  }
}

/** Current streak from the Today model's streak line ("13 day streak"), so the summary matches Today. */
export function streakDays(view: Pick<TodayModel, 'streakLine'>): number {
  const m = /^(\d+) day streak/.exec(view.streakLine);
  return m ? Number(m[1]) : 0;
}

export interface TodayCard {
  reps: number;
  /** "of 50"; null without a goal. */
  target: number | null;
  /** Bar fill 0–1; null hides the bar (no goal, rest day). */
  progress: number | null;
  done: boolean;
  /** "8 to go", "Goal done · 13-day streak", "Rest day"; null for none. */
  line: string | null;
}

/** "Today" card under the count: today's reps against the goal. */
export function todayCard(view: TodayModel): TodayCard {
  if (view.target == null) return { reps: view.reps, target: null, progress: null, done: false, line: null };
  if (view.rest) return { reps: view.reps, target: null, progress: null, done: false, line: 'Rest day' };
  const done = view.reps >= view.target;
  const streak = streakDays(view);
  return {
    reps: view.reps,
    target: view.target,
    progress: view.target <= 0 ? 1 : Math.min(1, view.reps / view.target),
    done,
    line: done ? (streak > 0 ? `Goal done · ${streak}-day streak` : 'Goal done') : `${view.target - view.reps} to go`,
  };
}

export function formSplit(reps: readonly Pick<Rep, 'quality'>[]): { full: number; good: number; shallow: number } {
  const split = { full: 0, good: 0, shallow: 0 };
  for (const r of reps) split[r.quality] += 1;
  return split;
}

/** "2.1s" between reps; "–" when there aren't two reps. */
export function paceText(a: Pick<SetAnalysis, 'avgIntervalSec'>): string {
  return a.avgIntervalSec === null ? '–' : `${a.avgIntervalSec.toFixed(1)}s`;
}

/** "Average depth · ±4% steady". */
export function depthCaption(a: Pick<SetAnalysis, 'depthStdPct' | 'depthConsistency'>): string {
  if (a.depthStdPct === null || a.depthConsistency === null) return 'Average depth';
  const word = a.depthConsistency === 'variable' ? 'varied' : 'steady';
  return `Average depth · ±${Math.round(a.depthStdPct)}% ${word}`;
}

/** One plain line under the pace curve. */
export function paceLine(a: Pick<SetAnalysis, 'tempo'>): string {
  if (!a.tempo) return 'Not enough reps to show pace.';
  if (a.tempo.trend === 'slowing') return 'Slower near the end.';
  if (a.tempo.trend === 'speeding-up') return 'Faster near the end.';
  return 'Steady through the set.';
}

/**
 * Pace over the set as reps per second (higher = quicker), one point per rep after the first.
 * Drawn as a smooth curve without axes; it is not a rep-by-rep table.
 */
export function paceSeries(a: Pick<SetAnalysis, 'intervals'>): number[] {
  return a.intervals.filter((i) => i.value > 0).map((i) => 1 / i.value);
}

export interface SetDetailsModel {
  date: string;
  reps: number;
  time: string;
  pace: string;
  depthPct: string;
  depthCaption: string;
  split: { full: number; good: number; shallow: number };
  paceSeries: number[];
  paceLine: string;
}

export function setDetails(record: SessionRecord, nowMs: number = Date.now(), timeZone?: string): SetDetailsModel {
  const a = analyzeSet(record.reps, record.startedAt, record.endedAt);
  return {
    date: formatSetDateTime(record.startedAt, nowMs, timeZone),
    reps: record.reps.length,
    time: setClock(setSeconds(record)),
    pace: paceText(a),
    depthPct: a.avgDepthPct === null ? '–' : `${a.avgDepthPct}%`,
    depthCaption: depthCaption(a),
    split: formSplit(record.reps),
    paceSeries: paceSeries(a),
    paceLine: paceLine(a),
  };
}
