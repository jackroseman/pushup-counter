import {
  challengeName,
  challengesEmpty,
  finishedTitle,
  headScore,
  shortTimeLeft,
  standings,
} from '../src/battles/challengeView';
import type { Battle, Participant } from '../src/battles/model';

const NOW = Date.parse('2026-11-25T15:00:00Z');
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

describe('empty states (E10, E11)', () => {
  it('waits for friends to load, then picks the right one', () => {
    expect(challengesEmpty(null, 0)).toBeNull();
    expect(challengesEmpty([], null)).toBeNull();
    expect(challengesEmpty([], 0)).toBe('noFriends');
    expect(challengesEmpty([], 3)).toBe('none');
    expect(challengesEmpty([battle({})], 0)).toBeNull();
  });
});

describe('standings', () => {
  it('uses server ranks and notes invited people', () => {
    const b = battle({
      kind: 'total',
      windowUnit: 'week',
      participants: [
        you({ validReps: 120, rank: 2 }),
        person({ userId: 'jack', validReps: 200, rank: 1 }),
        person({ userId: 'tara', status: 'invited' }),
      ],
    });
    expect(standings(b).map((r) => [r.name, r.score, r.note])).toEqual([
      ['Jack', '200', null],
      ['You', '120', null],
      ['Tara', '–', 'Invited'],
    ]);
    const duel = battle({ participants: [you(), person({ userId: 'brett', attemptsUsed: 1, validReps: 48 })] });
    expect(headScore(duel, you())).toBe('–');
    expect(headScore(duel, person({ userId: 'brett', attemptsUsed: 1, validReps: 48 }))).toBe('48');
  });
});

describe('results', () => {
  it('uses the RPC outcome label on a finished title', () => {
    const team = battle({
      kind: 'team',
      windowUnit: 'week',
      status: 'completed',
      myOutcomeLabel: 'Missed the goal',
      participants: [you(), person({ userId: 'leo' })],
    });
    expect(finishedTitle(team)).toBe('Missed the goal · Team week');
    const won = battle({ status: 'completed', myOutcomeLabel: 'Won', participants: [you({ isWinner: true }), person({ userId: 'brett' })] });
    expect(finishedTitle(won)).toBe('Won · Best set');
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

