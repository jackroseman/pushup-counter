/**
 * What a just-finished set can start. Best single set uses the claim rules:
 * not already an attempt, ended within claim_set_max_age_s, and a timed set
 * only when that timer is one of timed_durations_s. Most-reps windows do not
 * claim the set; it counts because it started inside the frozen window.
 * Streak and team are not offered until slice 6.
 */
import { addCalendarDays, addMonths, localDate, monthStart, weekStart } from '../progress/calendar';

export type ChallengeOffer =
  | { kind: 'best_set'; durationS: number | null }
  | { kind: 'total'; window: 'day' | 'week' | 'month' };

const TOTALS: ChallengeOffer[] = [
  { kind: 'total', window: 'day' },
  { kind: 'total', window: 'week' },
  { kind: 'total', window: 'month' },
];

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
  return [...best, ...TOTALS];
}

export function offerLabel(offer: ChallengeOffer): string {
  if (offer.kind === 'best_set') return offer.durationS ? `Best single set · ${offer.durationS} s` : 'Best single set';
  if (offer.window === 'day') return 'Most reps today';
  if (offer.window === 'week') return 'Most reps this week';
  return 'Most reps this month';
}

/** Local instant when a calendar window ends, searched to the minute. */
function windowEndMs(now: number, timeZone: string, window: 'day' | 'week' | 'month'): number {
  const today = localDate(now, timeZone);
  const boundary = window === 'day' ? addCalendarDays(today, 1) : window === 'week' ? addCalendarDays(weekStart(today), 7) : addMonths(monthStart(today), 1);
  let lo = now;
  let hi = now + 40 * 24 * 3600 * 1000;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(mid, timeZone) < boundary) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Shown when a calendar window is almost over. Sets already inside it still count. */
export function windowClosingNote(
  window: 'day' | 'week' | 'month',
  now: number,
  timeZone: string,
  withinHours = 3,
): string | null {
  const leftMs = windowEndMs(now, timeZone, window) - now;
  if (leftMs <= 0 || leftMs > withinHours * 3600_000) return null;
  const hours = Math.max(1, Math.round(leftMs / 3600_000));
  const name = window === 'day' ? 'Today' : window === 'week' ? 'This week' : 'This month';
  const already = window === 'day' ? 'today' : window === 'week' ? 'this week' : 'this month';
  return `${name} ends in ${hours} hour${hours === 1 ? '' : 's'}. Sets you already did ${already} count.`;
}
