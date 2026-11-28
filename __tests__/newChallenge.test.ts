import { DEFAULT_APP_SETTINGS } from '../src/backend/appSettings';
import {
  KIND_TILES,
  canSend,
  formFromRematch,
  hoursLabel,
  initialForm,
  lengthKey,
  lengthOptions,
  newChallengePayload,
  timeLimitLabel,
  withKind,
  withLength,
} from '../src/battles/newChallenge';

const s = {
  battle: DEFAULT_APP_SETTINGS.asyncBattleDefaults,
  streak: DEFAULT_APP_SETTINGS.streakLengths,
  team: DEFAULT_APP_SETTINGS.teamTargets,
};

describe('new challenge sheet (frame 21)', () => {
  it('starts on a 60 s best set, with friends from a rematch', () => {
    const f = initialForm(s, undefined, ['jack']);
    expect(f).toMatchObject({ kind: 'best_set', durationS: 60, deadlineHours: 24, friendIds: ['jack'] });
    expect(canSend(f)).toBe(true);
    expect(canSend(initialForm(s))).toBe(false);
  });

  it('uses the finished set timer, so the set can count', () => {
    expect(initialForm(s, undefined, [], null).durationS).toBeNull();
    expect(initialForm(s, undefined, [], 120).durationS).toBe(120);
  });

  it('prefills a rematch from the RPC fields', () => {
    expect(
      formFromRematch(s, {
        kind: 'total',
        durationDays: 1,
        friendIds: ['jack'],
        kindLabel: 'Most reps',
        lengthLabel: '1 day',
      }),
    ).toMatchObject({ kind: 'total', durationDays: 1, friendIds: ['jack'] });
    expect(
      formFromRematch(s, {
        kind: 'best_set',
        durationS: null,
        deadlineHours: 72,
        friendIds: ['jack'],
      }),
    ).toMatchObject({ kind: 'best_set', durationS: null, deadlineHours: 72, friendIds: ['jack'] });
    expect(
      formFromRematch(s, {
        kind: 'streak',
        streakDays: 14,
        friendIds: ['jack', 'tara'],
      }),
    ).toMatchObject({ kind: 'streak', streakDays: 14, friendIds: ['jack', 'tara'] });
    expect(
      formFromRematch(s, {
        kind: 'team',
        durationDays: 30,
        targetReps: 1000,
        friendIds: ['jack'],
      }),
    ).toMatchObject({ kind: 'team', durationDays: 30, targetReps: 1000 });
  });

  it('has four kind tiles with plain lines', () => {
    expect(KIND_TILES.map((t) => t.title)).toEqual(['Best set', 'Most reps', 'Streak', 'Team']);
  });

  it('offers a length per kind from app settings', () => {
    expect(lengthOptions('best_set', s).map((o) => o.label)).toEqual(['1 day', '3 days', '1 week']);
    expect(lengthOptions('total', s).map((o) => o.label)).toEqual(['1 day', '7 days', '14 days', '30 days']);
    expect(lengthOptions('streak', s).map((o) => o.label)).toEqual(['7 days', '14 days', '30 days']);
    const f = withLength(initialForm(s), '72');
    expect(f.deadlineHours).toBe(72);
    expect(lengthKey(f)).toBe('72');
    expect(hoursLabel(168)).toBe('1 week');
    expect(timeLimitLabel(60)).toBe('60 s');
    expect(timeLimitLabel(120)).toBe('2 min');
    expect(timeLimitLabel(null)).toBe('No limit');
  });
});

describe('create payload', () => {
  it('never sends a metric or an invite link', () => {
    const p = newChallengePayload({ ...initialForm(s), friendIds: ['jack'] });
    expect(p).toEqual({
      kind: 'best_set',
      durationS: 60,
      deadlineHours: 24,
      durationDays: undefined,
      streakDays: undefined,
      targetReps: undefined,
      friendIds: ['jack'],
      inviteLink: false,
    });
    expect('metric' in p).toBe(false);
  });

  it('sends only the fields each kind uses', () => {
    const base = { ...initialForm(s), friendIds: ['jack', 'tara'] };
    expect(newChallengePayload(withKind(base, 'total', s.team))).toMatchObject({
      kind: 'total',
      durationDays: 7,
      durationS: undefined,
      deadlineHours: undefined,
    });
    expect(newChallengePayload(withKind(base, 'streak', s.team))).toMatchObject({ kind: 'streak', streakDays: 7, durationDays: undefined });
    expect(newChallengePayload(withKind(base, 'team', s.team))).toMatchObject({ kind: 'team', durationDays: 7, targetReps: 500 });
    expect(newChallengePayload({ ...base, durationS: null }).durationS).toBeUndefined();
  });
});
