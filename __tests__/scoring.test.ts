import { Calibrator, depthRatio, median, qualityForRatio, qualityLabel, summarize, DEFAULT_CONFIG, Rep } from '../src/core';

describe('scoring', () => {
  it('depthRatio uses floor distance and clamps to 0..1', () => {
    expect(depthRatio(0.5, 0.08, 0.08)).toBe(1);
    expect(depthRatio(0.5, 0.5, 0.08)).toBe(0);
    expect(depthRatio(0.5, 0.29, 0.08)).toBeCloseTo(0.5, 5);
    expect(depthRatio(0.5, 0.6, 0.08)).toBe(0);
    expect(depthRatio(0.5, 0.0, 0.08)).toBe(1);
    expect(depthRatio(0.05, 0.03, 0.08)).toBe(0); // nonsense calibration
  });

  it('maps ratio to quality bands', () => {
    expect(qualityForRatio(0.9, DEFAULT_CONFIG)).toBe('full');
    expect(qualityForRatio(0.7, DEFAULT_CONFIG)).toBe('full');
    expect(qualityForRatio(0.5, DEFAULT_CONFIG)).toBe('good');
    expect(qualityForRatio(0.2, DEFAULT_CONFIG)).toBe('shallow');
    expect(qualityLabel('good')).toBe('Good');
  });

  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('Calibrator', () => {
  it('returns the median top distance', () => {
    const c = new Calibrator();
    for (let i = 0; i < 30; i++) c.add(0.5 + (i % 3) * 0.005, true);
    c.add(0, false); // untracked ignored
    const r = c.finish();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.calibration.topDistance).toBeCloseTo(0.505, 3);
  });

  it('fails with too few samples', () => {
    const c = new Calibrator();
    c.add(0.5, true);
    expect(c.finish()).toMatchObject({ ok: false, reason: 'not-enough-samples' });
  });

  it('fails when out of range', () => {
    const c = new Calibrator();
    for (let i = 0; i < 30; i++) c.add(0.05, true);
    expect(c.finish()).toMatchObject({ ok: false, reason: 'out-of-range' });
  });

  it('fails when the user is moving', () => {
    const c = new Calibrator();
    for (let i = 0; i < 30; i++) c.add(i % 2 ? 0.3 : 0.6, true);
    expect(c.finish()).toMatchObject({ ok: false, reason: 'too-much-movement' });
  });
});

describe('summarize', () => {
  const rep = (quality: Rep['quality'], rom: number | null): Rep => ({
    index: 0,
    timestamp: 0,
    quality,
    source: 'proximity',
    bottomDistance: null,
    topDistance: null,
    rangeOfMotion: rom,
    depthRatio: null,
    faceLostAtBottom: false,
  });

  it('computes totals, % full and avg ROM', () => {
    const s = summarize([rep('full', 0.3), rep('full', 0.35), rep('good', null), rep('shallow', 0.1)], 0, 61_000);
    expect(s.totalReps).toBe(4);
    expect(s.fullReps).toBe(2);
    expect(s.goodReps).toBe(1);
    expect(s.shallowReps).toBe(1);
    expect(s.percentFull).toBe(50);
    expect(s.avgRangeOfMotionCm).toBeCloseTo(25, 1);
    expect(s.durationSec).toBe(61);
  });

  it('handles empty sessions', () => {
    const s = summarize([], 0, 0);
    expect(s.percentFull).toBe(0);
    expect(s.avgRangeOfMotionCm).toBeNull();
  });
});
