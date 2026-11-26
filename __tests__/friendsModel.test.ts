import { friendBestSet, friendChallengeRows, friendRowSubtitle, headToHeadRecord, recentOutcome } from '../src/battles/friendsView';
import type { Battle, FriendRecord } from '../src/battles/model';

const NOW = Date.parse('2026-11-25T21:30:00Z');
const TZ = 'America/New_York';
type Recent = FriendRecord['recent'][number];
const side = (o: Partial<Recent['me']> = {}) => ({ rank: null, validReps: null, metricValue: null, isWinner: false, ...o });
const recent = (o: Partial<Recent>): Recent => ({
  challengeId: 'r1',
  finishedAt: '2026-11-16T20:00:00Z',
  kind: 'best_set',
  windowUnit: null,
  metric: null,
  durationS: 60,
  players: 2,
  me: side(),
  them: side(),
  ...o,
});
const record = (rows: Recent[]): FriendRecord => ({ played: 9, won: 4, drawn: 0, lost: 5, recent: rows });

describe('friends rows (frame 26, plan §5 #12 v1)', () => {
  it("shows this week's reps", () => {
    expect(friendRowSubtitle(198)).toBe('198 reps this week');
    expect(friendRowSubtitle(1)).toBe('1 rep this week');
    expect(friendRowSubtitle(0)).toBe('No reps this week');
    expect(friendRowSubtitle(undefined)).toBe('Not on your board yet');
  });
});

describe('friend page (frame 27, E14)', () => {
  const rows = [
    recent({ challengeId: 'a', me: side({ isWinner: true, rank: 1, validReps: 40 }), them: side({ rank: 2, validReps: 31 }) }),
    recent({
      challengeId: 'b',
      kind: 'total',
      windowUnit: 'week',
      finishedAt: '2026-11-09T20:00:00Z',
      me: side({ rank: 2 }),
      them: side({ rank: 1, isWinner: true, validReps: 300 }),
    }),
    recent({ challengeId: 'c', players: 4, me: side({ rank: 2, validReps: 30 }), them: side({ rank: 3, validReps: 41 }) }),
  ];

  it('counts your record together from the finished challenges', () => {
    expect(rows.map(recentOutcome)).toEqual(['won', 'lost', 'ahead']);
    expect(headToHeadRecord(record(rows))).toEqual({ youWon: 2, theyWon: 1, together: 3 });
    expect(headToHeadRecord(record([]))).toEqual({ youWon: 0, theyWon: 0, together: 0 });
  });

  it('takes their best set from best-set challenges only', () => {
    expect(friendBestSet(record(rows))).toBe(41);
    expect(friendBestSet(record([]))).toBeNull();
    expect(friendBestSet(null)).toBeNull();
  });

  it('lists open challenges with them first, then finished ones', () => {
    const open = {
      id: 'open',
      kind: 'best_set',
      status: 'active',
      attemptsAllowed: 1,
      endsAt: '2026-11-27T00:00:00Z',
      inviteExpiresAt: '2026-11-27T00:00:00Z',
      createdBy: 'brett',
      participants: [
        { userId: 'me', isMe: true, status: 'accepted', attemptsUsed: 0 },
        { userId: 'brett', isMe: false, status: 'accepted', attemptsUsed: 1 },
      ],
    } as unknown as Battle;
    const other = { ...open, id: 'other', participants: [open.participants[0], { ...open.participants[1], userId: 'jack' }] } as Battle;
    expect(friendChallengeRows('brett', [open, other], record(rows.slice(0, 2)), NOW, TZ)).toEqual([
      { challengeId: 'open', title: 'Best set', status: 'Your move' },
      { challengeId: 'a', title: 'Best set', status: 'Won · Nov 16' },
      { challengeId: 'b', title: 'Most reps', status: 'Lost · Nov 9' },
    ]);
  });
});
