import {
  challengeList,
  challengeName,
  challengesEmpty,
  detailLine,
  finishedTitle,
  headScore,
  headToHead,
  resultOf,
  rematchParams,
  shortTimeLeft,
  standings,
} from '../src/battles/challengeView';
import type { Battle, Participant } from '../src/battles/model';

const NOW = Date.parse('2026-11-25T15:00:00Z');
const TZ = 'America/New_York';
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

function person(over: Partial<Participant> & { userId: string }): Participant {
  return {
    username: over.userId,
    displayName: over.userId[0].toUpperCase() + over.userId.slice(1),
    status: 'accepted',
    isMe: false,
    attemptsUsed: 0,
    validReps: null,
    metricValue: null,
    avgDepthPct: null,
    tempoScore: null,
    rank: null,
    isWinner: false,
    ...over,
  };
}

function battle(over: Partial<Battle>): Battle {
  return {
    id: 'b1',
    mode: 'async',
    kind: 'best_set',
    windowUnit: null,
    metric: null,
    status: 'active',
    durationS: 60,
    attemptsAllowed: 1,
    targetReps: null,
    maxParticipants: 2,
    minQuality: 'good',
    inviteExpiresAt: iso(NOW + 24 * H),
    startsAt: null,
    endsAt: iso(NOW + 30 * H),
    createdAt: iso(NOW - 2 * H),
    finishedAt: null,
    createdBy: 'brett',
    locked: false,
    participants: [],
    inviteLinks: [],
    ...over,
  };
}

const you = (over: Partial<Participant> = {}) => person({ userId: 'you', displayName: 'Sunny', isMe: true, ...over });

describe('challenge list (frame 20)', () => {
  it('puts a best set to play under Your move with the score to beat', () => {
    const b = battle({ participants: [you(), person({ userId: 'brett', attemptsUsed: 1, validReps: 41 })] });
    const list = challengeList([b], NOW, TZ);
    expect(list.yourMove).toHaveLength(1);
    expect(list.yourMove[0]).toMatchObject({ type: 'play', title: 'Best set vs Brett', subtitle: '41 to beat · 1 day left' });
  });

  it('shows an invite to answer inline', () => {
    const b = battle({
      kind: 'total',
      windowUnit: 'week',
      createdBy: 'maya',
      participants: [person({ userId: 'maya' }), you({ status: 'invited' })],
    });
    expect(challengeList([b], NOW, TZ).yourMove[0]).toMatchObject({
      type: 'invite',
      title: 'Maya invited you',
      subtitle: 'Most reps this week',
    });
  });

  it('lists a team goal in progress with its total and bar', () => {
    const b = battle({
      kind: 'team',
      windowUnit: 'week',
      targetReps: 1000,
      participants: [you({ teamTotal: 611, validReps: 300 }), person({ userId: 'leo', teamTotal: 611, validReps: 311 })],
    });
    const row = challengeList([b], NOW, TZ).inProgress[0];
    expect(row).toMatchObject({ type: 'progress', title: 'Team week', right: '611 of 1,000', subtitle: 'You, Leo' });
    expect(row.type === 'progress' && row.progress).toBeCloseTo(0.611);
  });

  it('marks a finished win', () => {
    const b = battle({
      status: 'completed',
      finishedAt: iso(NOW - 3 * 24 * H),
      participants: [
        you({ attemptsUsed: 1, validReps: 52, rank: 1, isWinner: true }),
        person({ userId: 'jack', attemptsUsed: 1, validReps: 40, rank: 2 }),
      ],
    });
    expect(challengeList([b], NOW, TZ).finished[0]).toMatchObject({
      type: 'finished',
      won: true,
      title: 'Won vs Jack · Best set',
      day: 'Sun',
    });
  });
});

describe('empty states (E10, E11)', () => {
  it('waits for friends to load, then picks the right one', () => {
    expect(challengesEmpty(null, 0)).toBeNull();
    expect(challengesEmpty([], null)).toBeNull();
    expect(challengesEmpty([], 0)).toBe('noFriends');
    expect(challengesEmpty([], 3)).toBe('none');
    expect(challengesEmpty([battle({})], 0)).toBeNull();
  });
});

describe('detail (frame 23)', () => {
  it('builds the head-to-head card and the line under it', () => {
    const b = battle({ participants: [you(), person({ userId: 'brett', attemptsUsed: 1, validReps: 48 })] });
    const duel = headToHead(b)!;
    expect(duel.them.userId).toBe('brett');
    expect(headScore(b, duel.you)).toBe('–');
    expect(headScore(b, duel.them)).toBe('48');
    expect(detailLine(b, NOW)).toBe('Brett leads · 1 day left');
  });

  it('uses standings for three or more players', () => {
    const b = battle({
      kind: 'total',
      windowUnit: 'week',
      participants: [
        you({ validReps: 120, rank: 2 }),
        person({ userId: 'jack', validReps: 200, rank: 1 }),
        person({ userId: 'tara', status: 'invited' }),
      ],
    });
    expect(headToHead(b)).toBeNull();
    expect(standings(b).map((r) => [r.name, r.score, r.note])).toEqual([
      ['Jack', '200', null],
      ['You', '120', null],
      ['Tara', '–', 'Invited'],
    ]);
  });
});

describe('results (frame 25)', () => {
  it('names the winner, a draw, and team goals', () => {
    const lost = battle({ status: 'completed', participants: [you({ rank: 2 }), person({ userId: 'brett', rank: 1, isWinner: true })] });
    expect(resultOf(lost)).toMatchObject({ kind: 'lost', title: 'Brett won' });
    const draw = battle({ status: 'completed', participants: [you({ isWinner: true }), person({ userId: 'brett', isWinner: true })] });
    expect(resultOf(draw).title).toBe('Draw');
    const team = battle({ kind: 'team', windowUnit: 'week', status: 'completed', participants: [you(), person({ userId: 'leo' })] });
    expect(finishedTitle(team)).toBe('Missed the goal · Team week');
  });

  it('rematches the same people with the same settings', () => {
    const b = battle({
      kind: 'total',
      windowUnit: 'day',
      status: 'completed',
      participants: [you(), person({ userId: 'jack' }), person({ userId: 'tara', status: 'declined' })],
    });
    expect(rematchParams(b)).toEqual({ friendIds: ['jack'], offer: { kind: 'total', window: 'day' } });
    expect(rematchParams(battle({ durationS: 90, participants: [you(), person({ userId: 'jack' })] }))).toEqual({
      friendIds: ['jack'],
      offer: { kind: 'best_set', durationS: 90 },
    });
  });
});

describe('labels', () => {
  it('stays short and plain', () => {
    expect(shortTimeLeft(iso(NOW + 20 * 60_000), NOW)).toBe('20 min left');
    expect(shortTimeLeft(iso(NOW + 5 * H), NOW)).toBe('5 h left');
    expect(shortTimeLeft(iso(NOW - 1), NOW)).toBe('Ended');
    expect(challengeName(battle({ kind: 'streak', startsAt: '2026-11-23T05:00:00Z', endsAt: '2026-11-30T05:00:00Z' }))).toBe(
      '7-day streak',
    );
  });
});
