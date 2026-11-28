import { formatCount, formatShortDate } from '../progress';
import type { OpenChallenge } from './openChallenges';
import type { FriendRecord } from './model';

/** Friends row subtitle (plan §5 #12, v1): this week's reps from the league board. */
export function friendRowSubtitle(reps: number | null | undefined): string {
  if (reps == null) return 'Not on your board yet';
  return reps === 0 ? 'No reps this week' : `${formatCount(reps)} ${reps === 1 ? 'rep' : 'reps'} this week`;
}

/** Their best single set in a best-set challenge with you, from the record RPC. */
export function friendBestSet(rec: FriendRecord | null): number | null {
  if (!rec) return null;
  return rec.bestSet ?? null;
}

export interface FriendChallengeRow {
  challengeId: string;
  title: string;
  status: string;
  section: 'open' | 'finished';
}

/** The Challenges list on a friend's page: open RPC rows first, then finished events from the record. */
export function friendChallengeRows(
  friendId: string,
  rec: FriendRecord | null,
  now: number,
  timeZone: string,
  openRows: readonly OpenChallenge[] = [],
): FriendChallengeRow[] {
  const open = openRows
    .filter((r) => r.people.some((p) => p.userId === friendId && p.status !== 'declined' && p.status !== 'expired'))
    .map((r) => ({
      challengeId: r.challengeId,
      title: r.title,
      status: r.isMyTurn ? (r.needsResponse ? 'Invite' : 'Your turn') : r.statusLabel || 'Waiting',
      section: 'open' as const,
    }));
  const done = (rec?.finished ?? []).map((r) => ({
    challengeId: r.challengeId,
    title: r.title,
    status: `${r.outcomeLabel} · ${formatShortDate(r.finishedAt, timeZone, now)}`,
    section: 'finished' as const,
  }));
  return [...open, ...done];
}
