import { formatCount, formatShortDate } from '../progress';
import { kindLabel } from './challengeView';
import type { OpenChallenge } from './openChallenges';
import { Battle, FriendRecord, isOpen } from './model';

/** Friends row subtitle (plan §5 #12, v1): this week's reps from the league board. */
export function friendRowSubtitle(reps: number | null | undefined): string {
  if (reps == null) return 'Not on your board yet';
  return reps === 0 ? 'No reps this week' : `${formatCount(reps)} ${reps === 1 ? 'rep' : 'reps'} this week`;
}

type Recent = FriendRecord['recent'][number];

/** How one finished challenge went for the user against this friend. */
export function recentOutcome(r: Recent): 'won' | 'lost' | 'draw' | 'ahead' | 'behind' {
  if (r.me.isWinner && !r.them.isWinner) return 'won';
  if (r.them.isWinner && !r.me.isWinner) return 'lost';
  if (r.me.isWinner && r.them.isWinner) return 'draw';
  if (r.me.rank != null && r.them.rank != null) {
    if (r.me.rank === r.them.rank) return 'draw';
    return r.me.rank < r.them.rank ? 'ahead' : 'behind';
  }
  return 'draw';
}

/** "You won 4 · Brett won 1" card (frame 27), from the challenges you finished together. */
export function headToHeadRecord(rec: FriendRecord): { youWon: number; theyWon: number; together: number } {
  let youWon = 0;
  let theyWon = 0;
  for (const r of rec.recent) {
    const o = recentOutcome(r);
    if (o === 'won' || o === 'ahead') youWon += 1;
    else if (o === 'lost' || o === 'behind') theyWon += 1;
  }
  return { youWon, theyWon, together: rec.recent.length };
}

/** Their best single set in a best-set challenge with you, if any. */
export function friendBestSet(rec: FriendRecord | null): number | null {
  if (!rec) return null;
  const sets = rec.recent.filter((r) => r.kind === 'best_set' && r.them.validReps != null).map((r) => r.them.validReps as number);
  return sets.length ? Math.max(...sets) : null;
}

export interface FriendChallengeRow {
  challengeId: string;
  title: string;
  status: string;
}

const OUTCOME_WORD = { won: 'Won', lost: 'Lost', draw: 'Draw', ahead: 'Ahead', behind: 'Behind' } as const;

/** The Challenges list on a friend's page: open ones with them first, then finished ones. */
export function friendChallengeRows(
  friendId: string,
  battles: readonly Battle[],
  rec: FriendRecord | null,
  now: number,
  timeZone: string,
  openRows: readonly OpenChallenge[] = [],
): FriendChallengeRow[] {
  const fromOpen = openRows
    .filter((r) => r.people.some((p) => p.userId === friendId && p.status !== 'declined' && p.status !== 'expired'))
    .map((r) => ({
      challengeId: r.challengeId,
      title: r.title,
      status: r.isMyTurn ? (r.needsResponse ? 'Invite' : 'Your turn') : r.statusLabel || 'Waiting',
    }));
  const open = fromOpen.length
    ? fromOpen
    : battles
        .filter((b) => isOpen(b) && b.participants.some((p) => p.userId === friendId && p.status !== 'declined' && p.status !== 'expired'))
        .map((b) => ({
          challengeId: b.id,
          title: kindLabel(b),
          status: 'In progress',
        }));
  const done = (rec?.finished ?? rec?.recent ?? []).map((r) => {
    const finishedAt = r.finishedAt;
    const label = 'outcomeLabel' in r && r.outcomeLabel ? r.outcomeLabel : OUTCOME_WORD[recentOutcome(r as FriendRecord['recent'][number])];
    return {
      challengeId: r.challengeId,
      title: 'title' in r && r.title ? r.title : kindLabel(r),
      status: `${label} · ${formatShortDate(finishedAt, timeZone, now)}`,
    };
  });
  return [...open, ...done];
}
