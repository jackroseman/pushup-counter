/**
 * When a battle set ends by itself (pure, unit-tested). Timed battles stop at the duration.
 * Max-reps battles stop after a pause with no reps (or at a hard cap) so nobody has to reach
 * for the phone mid-set; the user can always end early.
 */
export interface BattleRules {
  format: 'max_reps' | 'timed';
  durationS: number | null;
  /** Max reps: end after this long without a new rep (counting starts at "Go"). */
  idleEndS: number;
  /** Max reps: hard cap on the set length. */
  capS: number;
}

export type EndReason = 'time_up' | 'idle' | 'cap';

export function battleEndReason(rules: BattleRules, now: number, goAt: number, lastRepAt: number | null): EndReason | null {
  const elapsed = now - goAt;
  if (rules.format === 'timed') return elapsed >= (rules.durationS ?? 60) * 1000 ? 'time_up' : null;
  if (elapsed >= rules.capS * 1000) return 'cap';
  const since = now - (lastRepAt ?? goAt);
  return since >= rules.idleEndS * 1000 ? 'idle' : null;
}

/** Seconds shown on the battle timer: counting down for timed battles, else until the idle stop. */
export function battleClockText(rules: BattleRules, now: number, goAt: number, lastRepAt: number | null): string {
  if (rules.format === 'timed') {
    const left = Math.max(0, Math.ceil(((rules.durationS ?? 60) * 1000 - (now - goAt)) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  const idleLeft = Math.max(0, Math.ceil((rules.idleEndS * 1000 - (now - (lastRepAt ?? goAt))) / 1000));
  return idleLeft <= 5 ? `Ends in ${idleLeft}…` : '';
}
