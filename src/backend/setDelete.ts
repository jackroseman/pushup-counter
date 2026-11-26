import type { KeyValueStore, SessionRecord } from '../storage/history';
import { queueSetDelete } from './sync';

/** Delete set (Set details): gone from this phone at once, and from the backup when online. */
export type DeleteSetResult = { ok: true } | { ok: false; reason: 'challenge' };

/** A set that belongs to a challenge stays: challenge results must not change under other players. */
export const isChallengeSet = (r: Pick<SessionRecord, 'challengeId' | 'battleId'>) => !!(r.challengeId || r.battleId);

export async function deleteSet(opts: {
  record: SessionRecord;
  /** Signed-in account, or null. */
  userId: string | null;
  kv: KeyValueStore;
  removeLocal: (id: string) => Promise<unknown>;
  /** Whether the backup copy is in a challenge (a set used as a best-set try). Throws when offline. */
  inChallenge: ((userId: string, id: string) => Promise<boolean>) | null;
}): Promise<DeleteSetResult> {
  const { record, userId, kv } = opts;
  if (isChallengeSet(record)) return { ok: false, reason: 'challenge' };
  if (userId && opts.inChallenge) {
    // Offline: delete here and let the queued server delete sort it out (it never touches challenge sets).
    const linked = await opts.inChallenge(userId, record.id).catch(() => false);
    if (linked) return { ok: false, reason: 'challenge' };
  }
  await opts.removeLocal(record.id);
  await queueSetDelete(kv, record.id, userId);
  return { ok: true };
}
