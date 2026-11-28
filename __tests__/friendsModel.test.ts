import { friendBestSet, friendChallengeRows, friendRowSubtitle } from '../src/battles/friendsView';
import type { FriendRecord } from '../src/battles/model';
import type { OpenChallenge } from '../src/battles/openChallenges';

const NOW = Date.parse('2026-11-25T21:30:00Z');
const TZ = 'America/New_York';

const record = (over: Partial<FriendRecord> = {}): FriendRecord => ({
  played: 2,
  won: 1,
  drawn: 0,
  lost: 1,
  recent: [],
  bestSet: 31,
  finished: [
    {
      challengeId: 'a',
      kind: 'best_set',
      title: 'Best set',
      outcome: 'win',
      outcomeLabel: 'Won',
      finishedAt: '2026-11-16T20:00:00Z',
      myReps: 40,
      theirReps: 31,
      sortRank: 1,
    },
    {
      challengeId: 'b',
      kind: 'total',
      title: 'Most reps',
      outcome: 'loss',
      outcomeLabel: 'Lost',
      finishedAt: '2026-11-09T20:00:00Z',
      myReps: null,
      theirReps: 300,
      sortRank: 2,
    },
  ],
  ...over,
});

describe('friends rows (frame 26, plan §5 #12 v1)', () => {
  it("shows this week's reps", () => {
    expect(friendRowSubtitle(198)).toBe('198 reps this week');
    expect(friendRowSubtitle(1)).toBe('1 rep this week');
    expect(friendRowSubtitle(0)).toBe('No reps this week');
    expect(friendRowSubtitle(undefined)).toBe('Not on your board yet');
  });
});

describe('friend page (frame 27, E14)', () => {
  it('takes their best set from the record RPC', () => {
    expect(friendBestSet(record())).toBe(31);
    expect(friendBestSet(record({ bestSet: null }))).toBeNull();
    expect(friendBestSet(null)).toBeNull();
  });

  it('lists open RPC rows first, then finished events from the record', () => {
    const open = [
      {
        challengeId: 'open',
        title: 'Best set vs Brett',
        isMyTurn: true,
        needsResponse: false,
        statusLabel: '28 to beat',
        people: [
          { userId: 'me', username: 'me', displayName: 'Me', status: 'accepted', isMe: true },
          { userId: 'brett', username: 'brett', displayName: 'Brett', status: 'accepted', isMe: false },
        ],
      },
      {
        challengeId: 'other',
        title: 'Best set vs Jack',
        isMyTurn: true,
        needsResponse: false,
        statusLabel: '20 to beat',
        people: [
          { userId: 'me', username: 'me', displayName: 'Me', status: 'accepted', isMe: true },
          { userId: 'jack', username: 'jack', displayName: 'Jack', status: 'accepted', isMe: false },
        ],
      },
    ] as unknown as OpenChallenge[];
    expect(friendChallengeRows('brett', record(), NOW, TZ, open)).toEqual([
      { challengeId: 'open', title: 'Best set vs Brett', status: 'Your turn', section: 'open' },
      { challengeId: 'a', title: 'Best set', status: 'Won · Nov 16', section: 'finished' },
      { challengeId: 'b', title: 'Most reps', status: 'Lost · Nov 9', section: 'finished' },
    ]);
  });
});
