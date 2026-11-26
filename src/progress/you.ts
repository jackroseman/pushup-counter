import { formatCount, type Badge, type ProgressModel, type ShelfRecord } from './progress';
import { formatFriendlyDay } from './format';

/** One records tile on You (frame 14, E6). */
export interface YouTile {
  label: string;
  value: string;
  caption: string;
}

/** The milestone card: "Next milestone 1,371 / 10,000" (frame 14) or "First milestone 0 / 1,000" (E5). */
export interface YouMilestone {
  label: 'First milestone' | 'Next milestone';
  current: number;
  target: number;
  progress: number;
}

export interface YouRecentInput {
  id: string;
  startedAt: number;
  reps: number;
}

export interface YouRecentRow extends YouRecentInput {
  best: boolean;
}

export interface YouModel {
  /** E5: no sets anywhere. One card replaces the records grid and recent sets. */
  empty: boolean;
  /** E6: no daily goal. The streak tile becomes "Sets", and a "Set a daily goal" row replaces the milestone. */
  noGoal: boolean;
  tiles: YouTile[];
  /** Null when every milestone is reached, and on E6. */
  milestone: YouMilestone | null;
  showGoalRow: boolean;
  recent: YouRecentRow[];
}

export const RECENT_SETS = 3;

/** First milestone not reached yet, or null when all are reached. */
export function nextMilestone(badges: readonly Badge[], lifetime: number): YouMilestone | null {
  const sorted = [...badges].sort((a, b) => a.milestone - b.milestone);
  const next = sorted.find((badge) => badge.earnedOn == null && lifetime < badge.milestone);
  if (!next) return null;
  const earnedAny = sorted.some((badge) => badge.earnedOn != null || lifetime >= badge.milestone);
  const current = Math.max(0, Math.min(lifetime, next.milestone));
  return {
    label: earnedAny ? 'Next milestone' : 'First milestone',
    current,
    target: next.milestone,
    progress: next.milestone > 0 ? current / next.milestone : 0,
  };
}

function recordCaption(record: ShelfRecord | null, nowMs: number, timeZone: string): string {
  return record ? formatFriendlyDay(record.date, nowMs, timeZone) : '';
}

/**
 * Everything the You tab decides (frame 14, E5, E6). Pure, so the rules are unit-tested.
 * `hasGoal`: a daily goal covers today (no goal = E6).
 */
export function buildYou(input: {
  view: ProgressModel;
  lifetimeReps: number;
  setCount: number;
  hasGoal: boolean;
  recent: readonly YouRecentInput[];
  nowMs: number;
  timeZone: string;
}): YouModel {
  const { view, lifetimeReps, setCount, hasGoal, nowMs, timeZone } = input;
  const empty = view.empty && setCount === 0 && lifetimeReps === 0;
  const noGoal = !hasGoal;
  const best = view.bestSet;
  const streakDays = view.longestStreak;
  const tiles: YouTile[] = [
    { label: 'Lifetime', value: formatCount(lifetimeReps), caption: 'reps' },
    { label: 'Best set', value: best ? formatCount(best.reps) : '0', caption: recordCaption(best, nowMs, timeZone) },
    { label: 'Best day', value: view.bestDay ? formatCount(view.bestDay.reps) : '0', caption: recordCaption(view.bestDay, nowMs, timeZone) },
    noGoal
      ? { label: 'Sets', value: formatCount(setCount), caption: 'all time' }
      : { label: 'Longest streak', value: formatCount(streakDays), caption: streakDays === 1 ? 'day' : 'days' },
  ];
  const sorted = [...input.recent].sort((a, b) => b.startedAt - a.startedAt).slice(0, RECENT_SETS);
  let bestMarked = false;
  const recent = sorted.map((row) => {
    const isBest =
      !bestMarked && best != null && row.reps === best.reps && formatFriendlyDay(row.startedAt, nowMs, timeZone) === formatFriendlyDay(best.date, nowMs, timeZone);
    if (isBest) bestMarked = true;
    return { ...row, best: isBest };
  });
  return {
    empty,
    noGoal,
    tiles,
    milestone: noGoal && !empty ? null : nextMilestone(view.badges, lifetimeReps),
    showGoalRow: noGoal && !empty,
    recent: empty ? [] : recent,
  };
}
