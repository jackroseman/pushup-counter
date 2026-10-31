import { analyzeSet, mean, stdDev, thirds, tempoTrendLabel, Rep, TraceRecorder } from '../src/core';

function rep(index: number, timestamp: number, depth: number | null, opts: Partial<Rep> = {}): Rep {
  return {
    index,
    timestamp,
    quality: depth === null ? 'full' : depth >= 0.7 ? 'full' : depth >= 0.45 ? 'good' : 'shallow',
    source: 'depth',
    bottomDistance: null,
    topDistance: null,
    rangeOfMotion: null,
    depthRatio: depth,
    faceLostAtBottom: false,
    ...opts,
  };
}

describe('helpers', () => {
  it('mean / stdDev / thirds', () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(thirds([1, 2])).toBeNull();
    expect(thirds([1, 2, 3, 4, 5, 6])).toEqual({ first: 1.5, last: 5.5 });
  });
});

describe('analyzeSet', () => {
  // 7 reps; intervals 1,1,1,1.5,2,2 s
  const times = [1000, 2000, 3000, 4000, 5500, 7500, 9500];
  const depths = [0.8, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4];
  const reps = times.map((t, i) =>
    rep(i + 1, t, depths[i], { descentMs: 400 + i * 100, ascentMs: 300 + i * 50, startedAt: t - 800, intervalMs: i ? t - times[i - 1] : null })
  );
  const a = analyzeSet(reps, 0, 12_000);

  it('counts and duration', () => {
    expect(a.totalReps).toBe(7);
    expect(a.fullReps).toBe(4);
    expect(a.goodReps).toBe(2);
    expect(a.shallowReps).toBe(1);
    expect(a.durationSec).toBe(12);
    expect(a.activeDurationSec).toBe(9.3); // 200 -> 9500
  });

  it('time between reps', () => {
    expect(a.intervals.map((x) => x.value)).toEqual([1, 1, 1, 1.5, 2, 2]);
    expect(a.intervals.map((x) => x.rep)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(a.avgIntervalSec).toBeCloseTo(1.42, 2);
    expect(a.medianIntervalSec).toBe(1.25);
    expect(a.repsPerMinute).toBeCloseTo(42.4, 1);
  });

  it('tempo trend detects fatigue (last third slower than first)', () => {
    expect(a.tempo).toEqual({ firstThirdSec: 1, lastThirdSec: 2, changePct: 100, trend: 'slowing' });
    expect(tempoTrendLabel(a.tempo)).toBe('Slowed down 100%');
  });

  it('depth metrics', () => {
    expect(a.depthPcts.map((d) => d.value)).toEqual([80, 80, 75, 70, 60, 50, 40]);
    expect(a.avgDepthPct).toBe(65);
    expect(a.depthStdPct).toBeCloseTo(14.4, 1);
    expect(a.depthConsistency).toBe('variable');
    expect(a.depthChangePct).toBe(-35);
  });

  it('descent / ascent and fastest / slowest rep', () => {
    expect(a.avgDescentSec).toBe(0.7);
    expect(a.avgAscentSec).toBe(0.45);
    expect(a.fastestRep).toEqual({ rep: 1, value: 0.7 });
    expect(a.slowestRep).toEqual({ rep: 7, value: 1.6 });
  });

  it('steady pace and consistent depth', () => {
    const steady = analyzeSet(
      [0, 1, 2, 3, 4, 5].map((i) => rep(i + 1, 1000 + i * 1500, 0.8 + (i % 2) * 0.02)),
      0,
      10_000
    );
    expect(steady.tempo?.trend).toBe('steady');
    expect(tempoTrendLabel(steady.tempo)).toBe('Steady pace');
    expect(steady.depthConsistency).toBe('very consistent');
  });

  it('older sets without timing: intervals from timestamps, rep times fall back to intervals', () => {
    const old = analyzeSet([rep(1, 1000, null, { source: 'proximity' }), rep(2, 2500, null), rep(3, 4500, null)], 0, 5000);
    expect(old.intervals.map((x) => x.value)).toEqual([1.5, 2]);
    expect(old.avgDescentSec).toBeNull();
    expect(old.avgDepthPct).toBeNull();
    expect(old.depthConsistency).toBeNull();
    expect(old.tempo).toBeNull();
    expect(old.fastestRep).toEqual({ rep: 2, value: 1.5 });
    expect(tempoTrendLabel(old.tempo)).toBe('Not enough reps');
  });

  it('empty set', () => {
    const e = analyzeSet([], 0, 0);
    expect(e.totalReps).toBe(0);
    expect(e.avgIntervalSec).toBeNull();
    expect(e.fastestRep).toBeNull();
    expect(e.activeDurationSec).toBeNull();
  });
});

describe('TraceRecorder', () => {
  it('downsamples ~30 Hz to 10 Hz buckets, null where untracked', () => {
    const rec = new TraceRecorder(1000);
    rec.add(0.5, 500); // before start: ignored
    rec.add(0.5, 1000);
    rec.add(0.4, 1033);
    rec.add(0.3, 1066);
    rec.add(null, 1100);
    rec.add(null, 1150);
    rec.add(0.2, 1210);
    expect(rec.finish()).toEqual([
      [0, 0.4],
      [100, null],
      [200, 0.2],
    ]);
  });

  it('halves resolution when the trace gets too long', () => {
    const rec = new TraceRecorder(0, { bucketMs: 100, maxPoints: 10 });
    for (let t = 0; t < 2000; t += 50) rec.add(0.5, t);
    const pts = rec.finish();
    expect(pts.length).toBeLessThanOrEqual(10);
    expect(rec.resolutionMs).toBeGreaterThan(100);
    expect(pts.every(([, d]) => d === 0.5)).toBe(true);
  });
});
