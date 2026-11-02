import { median } from '../core/scoring';
import { formatCount } from './progress';

/** Improvement weights. The live board reads these from the database; this copy is the phone's default. */
export interface LeagueWeights {
  perRepAboveUsual: number;
  perGoalDay: number;
  perfectWeek: number;
  baselineWeeks: number;
  baselineMinWeeks: number;
}

export const DEFAULT_LEAGUE_WEIGHTS: LeagueWeights = {
  perRepAboveUsual: 1,
  perGoalDay: 20,
  perfectWeek: 30,
  baselineWeeks: 8,
  baselineMinWeeks: 3,
};

export const WEEK_LINE = "Each person's week is Monday to Sunday where they are.";
export const CROWN_CAPTION = 'Last week, among your current friends.';
export const NO_FRIENDS = "Add a friend to start this week's board.";
export const LEAGUE_ABOUT =
  'A weekly board with the friends you accept. One tab is counted reps. The other is improvement: beating your usual week, hitting goal days, and a perfect week after Sunday.';
export const FRIENDS_LEAGUE_COPY =
  "Friends are on your weekly league together. They can challenge each other and see battle results. They don't see each other's sets.";
export const FRIEND_WEEK_SUBTITLE = "This week's league, and your battles together.";

/**
 * Median of the completed weeks that count. Pass them newest first.
 * Fewer than baselineMinWeeks means the usual week is unused.
 */
export function leagueUsual(completedWeekReps: readonly number[], weights: LeagueWeights = DEFAULT_LEAGUE_WEIGHTS): number | null {
  const samples = completedWeekReps.slice(0, weights.baselineWeeks);
  if (samples.length < weights.baselineMinWeeks) return null;
  return median(samples);
}

/** Section 7.3. Every term is an integer and none of them goes below zero. */
export function leaguePoints(input: {
  weekReps: number;
  usual: number | null;
  goalDaysHit: number;
  goalDaysScheduled: number;
  weekEnded: boolean;
  weights?: LeagueWeights;
}): { beat: number; goal: number; perfect: number; points: number } {
  const w = input.weights ?? DEFAULT_LEAGUE_WEIGHTS;
  const beat = input.usual == null ? 0 : Math.floor(Math.max(0, input.weekReps - input.usual) * w.perRepAboveUsual);
  const goal = input.goalDaysHit * w.perGoalDay;
  const perfect =
    input.weekEnded && input.goalDaysScheduled > 0 && input.goalDaysHit === input.goalDaysScheduled ? w.perfectWeek : 0;
  return { beat, goal, perfect, points: beat + goal + perfect };
}

/**
 * RANK over the score, high to low. A tie shares the rank, so the next person skips ahead: 1, 2, 2, 4.
 * Later score parts break the tie. Nothing about who arrived first does.
 */
export function rankLeague<T>(rows: readonly T[], score: (row: T) => readonly number[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => {
    const left = score(a);
    const right = score(b);
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return right[i] - left[i];
    }
    return 0;
  });
  let rank = 1;
  return sorted.map((row, index) => {
    if (index > 0) {
      const prev = score(sorted[index - 1]);
      const cur = score(row);
      const tied = prev.length === cur.length && prev.every((n, i) => n === cur[i]);
      if (!tied) rank = index + 1;
    }
    return { ...row, rank };
  });
}

/** Whole numbers stay whole. A half keeps one decimal. */
export function formatLeagueNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return formatCount(rounded);
  const [whole, frac] = rounded.toFixed(1).split('.');
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${formatCount(Math.abs(Number(whole)))}.${frac}`;
}

export function improvementDetail(row: {
  reps: number;
  goalDaysHit: number;
  goalDaysScheduled: number;
  usual: number | null;
  baselineWeeks: number;
  baselineMinWeeks: number;
}): string {
  const baseline = row.usual == null ? `Baseline ${row.baselineWeeks}/${row.baselineMinWeeks} weeks` : `Usual ${formatLeagueNumber(row.usual)}`;
  return `${formatCount(row.reps)} reps · ${row.goalDaysHit}/${row.goalDaysScheduled} goal days · ${baseline}`;
}

export function friendWeekLine(reps: number, points: number): string {
  return `This week: ${formatCount(reps)} reps · ${formatCount(points)} improvement points`;
}

export function parseLeagueWeights(value: unknown, fallback: LeagueWeights = DEFAULT_LEAGUE_WEIGHTS): LeagueWeights {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const row = value as Record<string, unknown>;
  const perRep = row.per_rep_above_usual;
  const perGoal = row.per_goal_day;
  const perfect = row.perfect_week;
  const baseline = row.baseline_weeks;
  const minimum = row.baseline_min_weeks;
  if (typeof perRep !== 'number' || !Number.isFinite(perRep) || perRep < 0) return fallback;
  if (!whole(perGoal, 0, 100000) || !whole(perfect, 0, 100000)) return fallback;
  if (!whole(baseline, 1, 52) || !whole(minimum, 1, baseline as number)) return fallback;
  return {
    perRepAboveUsual: perRep,
    perGoalDay: perGoal as number,
    perfectWeek: perfect as number,
    baselineWeeks: baseline as number,
    baselineMinWeeks: minimum as number,
  };
}

function whole(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
