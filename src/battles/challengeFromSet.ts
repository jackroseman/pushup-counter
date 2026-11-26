/**
 * What a just-finished set can start. Best single set uses the claim rules:
 * not already an attempt, ended within claim_set_max_age_s, and a timed set
 * only when that timer is one of timed_durations_s. Most-reps windows do not
 * claim the set; it counts because it started inside the frozen window.
 * Streak and team never claim the set. Every set inside the window counts.
 */
export type ChallengeOffer =
  | { kind: 'best_set'; durationS: number | null }
  | { kind: 'total'; window: 'day' | 'week' | 'month' }
  | { kind: 'streak' }
  | { kind: 'team' };

const TOTALS: ChallengeOffer[] = [
  { kind: 'total', window: 'day' },
  { kind: 'total', window: 'week' },
  { kind: 'total', window: 'month' },
];

const TOGETHER: ChallengeOffer[] = [{ kind: 'streak' }, { kind: 'team' }];

export function challengeOffers(
  set: { timerDurationS?: number | null; challengeId?: string | null; battleId?: string | null; endedAt?: number | null },
  opts: { timedDurationsS: readonly number[]; claimMaxAgeS: number; now?: number },
): ChallengeOffer[] {
  const linked = set.challengeId || set.battleId;
  const now = opts.now ?? Date.now();
  const endedAt = set.endedAt ?? now;
  const ageOk = now - endedAt <= opts.claimMaxAgeS * 1000 && endedAt <= now + 2 * 60_000;
  const timer = set.timerDurationS;
  const timerOk = timer == null || opts.timedDurationsS.includes(timer);
  const best: ChallengeOffer[] = !linked && ageOk && timerOk ? [{ kind: 'best_set', durationS: timer ?? null }] : [];
  return [...best, ...TOTALS, ...TOGETHER];
}

/**
 * "Challenge a friend" on the post-set summary opens New challenge with this set. A set
 * that can be claimed starts on that best set, so the timer matches and the set is the
 * creator's attempt. Anything else starts on most reps today, which counts the set
 * without claiming it. Signed out, New challenge shows the sign-in pitch.
 */
export function summaryChallengeOffer(
  set: { timerDurationS?: number | null; challengeId?: string | null; battleId?: string | null; endedAt?: number | null },
  opts: { timedDurationsS: readonly number[]; claimMaxAgeS: number; now?: number },
): ChallengeOffer {
  return challengeOffers(set, opts).find((offer) => offer.kind === 'best_set') ?? TOTALS[0];
}
