/**
 * Which battle formats can be created from the set that just finished.
 * Live is never offered. Timed is offered only when that set was itself timed,
 * and only at that exact timer (which must also be an allowed preset).
 * An older set, or one already in a battle, is not offered — the server repeats that rule.
 */
export type ChallengeFormatName = 'max_reps' | 'timed' | 'multi_day';

export interface ChallengeFormat {
  format: ChallengeFormatName;
  /** Timed battles only: must equal the finished set's timer. */
  durationS: number | null;
}

export function challengeFormats(
  set: { timerDurationS?: number | null; battleId?: string | null },
  timedDurationsS: readonly number[],
): ChallengeFormat[] {
  if (set.battleId) return [];
  const out: ChallengeFormat[] = [{ format: 'max_reps', durationS: null }];
  const timer = set.timerDurationS;
  if (typeof timer === 'number' && timedDurationsS.includes(timer)) {
    out.push({ format: 'timed', durationS: timer });
  }
  out.push({ format: 'multi_day', durationS: null });
  return out;
}
