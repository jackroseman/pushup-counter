import { challengeFormats } from '../src/battles/challengeFromSet';

const presets = [60, 120];

describe('challengeFormats', () => {
  it('offers max reps and multi-day for an untimed solo set, and never live or timed', () => {
    expect(challengeFormats({ timerDurationS: null }, presets)).toEqual([
      { format: 'max_reps', durationS: null },
      { format: 'multi_day', durationS: null },
    ]);
    expect(challengeFormats({}, presets).map((f) => f.format)).toEqual(['max_reps', 'multi_day']);
    expect(challengeFormats({ timerDurationS: null }, presets).some((f) => f.format === 'timed')).toBe(false);
  });

  it('offers timed only at the set timer, and only when that duration is an allowed preset', () => {
    expect(challengeFormats({ timerDurationS: 60 }, presets)).toEqual([
      { format: 'max_reps', durationS: null },
      { format: 'timed', durationS: 60 },
      { format: 'multi_day', durationS: null },
    ]);
    // 120 is allowed in general, but this set was not a 120 s set.
    expect(challengeFormats({ timerDurationS: 60 }, presets).filter((f) => f.format === 'timed')).toEqual([
      { format: 'timed', durationS: 60 },
    ]);
    expect(challengeFormats({ timerDurationS: 45 }, presets).map((f) => f.format)).toEqual(['max_reps', 'multi_day']);
    expect(challengeFormats({ timerDurationS: 120 }, [60]).map((f) => f.format)).toEqual(['max_reps', 'multi_day']);
  });

  it('does not offer a set that is already a battle attempt', () => {
    expect(challengeFormats({ timerDurationS: 60, battleId: 'b1' }, presets)).toEqual([]);
  });
});
