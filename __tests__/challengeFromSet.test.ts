import { challengeOffers, offerLabel, windowClosingNote } from '../src/battles/challengeFromSet';

const presets = [60, 120];
const now = Date.parse('2026-11-02T15:00:00Z');
const opts = { timedDurationsS: presets, claimMaxAgeS: 1800, now };

describe('challengeOffers', () => {
  it('offers best single set and the three windows for a fresh untimed set', () => {
    const offers = challengeOffers({ timerDurationS: null, endedAt: now - 60_000 }, opts);
    expect(offers).toEqual([
      { kind: 'best_set', durationS: null },
      { kind: 'total', window: 'day' },
      { kind: 'total', window: 'week' },
      { kind: 'total', window: 'month' },
    ]);
    expect(offers.map(offerLabel)).toEqual(['Best single set', 'Most reps today', 'Most reps this week', 'Most reps this month']);
  });

  it('keeps a timed set only when that timer is allowed', () => {
    expect(challengeOffers({ timerDurationS: 60, endedAt: now }, opts)[0]).toEqual({ kind: 'best_set', durationS: 60 });
    expect(challengeOffers({ timerDurationS: 45, endedAt: now }, opts).some((o) => o.kind === 'best_set')).toBe(false);
    expect(challengeOffers({ timerDurationS: 120, endedAt: now }, { ...opts, timedDurationsS: [60] }).some((o) => o.kind === 'best_set')).toBe(false);
  });

  it('hides best single set when the set is already linked or too old, and keeps the windows', () => {
    const windows = [
      { kind: 'total', window: 'day' },
      { kind: 'total', window: 'week' },
      { kind: 'total', window: 'month' },
    ];
    expect(challengeOffers({ timerDurationS: 60, endedAt: now, battleId: 'b1' }, opts)).toEqual(windows);
    expect(challengeOffers({ timerDurationS: 60, endedAt: now, challengeId: 'c1' }, opts)).toEqual(windows);
    expect(challengeOffers({ timerDurationS: null, endedAt: now - 1800_000 - 1 }, opts)).toEqual(windows);
  });
});

describe('windowClosingNote', () => {
  it('speaks up only when the window is almost over', () => {
    expect(windowClosingNote('day', Date.parse('2026-11-02T12:00:00Z'), 'UTC')).toBeNull();
    expect(windowClosingNote('day', Date.parse('2026-11-02T22:30:00Z'), 'UTC')).toMatch(/Today ends in \d hours?\. Sets you already did today count\./);
  });
});
