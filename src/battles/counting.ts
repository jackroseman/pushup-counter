import type { Rep } from '../core/types';
import type { BattleRules } from './battleClock';

/**
 * What the server will count for this attempt, for the instant "you scored N" message.
 * Mirrors battle_entries: Good-or-better reps (Full counts too, Shallow never does), and in
 * a timed battle only reps completed within the duration. The server still has the final
 * say (it also drops implausible reps), so the battle screen shows its number once uploaded.
 */
export function countedReps(reps: Rep[], startedAt: number, rules: Pick<BattleRules, 'format' | 'durationS'>): number {
  const limit = rules.format === 'timed' && rules.durationS ? startedAt + rules.durationS * 1000 : Infinity;
  return reps.filter((r) => r.quality !== 'shallow' && r.timestamp <= limit).length;
}
