import { RepDetector, Rep } from '../src/core';

const TOP = 0.5;
const cal = { topDistance: TOP };

/** Feed a face-distance trajectory at 30 Hz starting at t0; returns completed reps and end time. */
function feedFace(det: RepDetector, distances: (number | null)[], t0: number, dtMs = 33): { reps: Rep[]; t: number } {
  const reps: Rep[] = [];
  let t = t0;
  for (const d of distances) {
    const r = det.onFaceDistance(d, d !== null, t);
    if (r) reps.push(r);
    t += dtMs;
  }
  return { reps, t };
}

function ramp(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => from + ((to - from) * (i + 1)) / steps);
}

describe('RepDetector - proximity counting', () => {
  it('counts near -> far as one rep', () => {
    const det = new RepDetector();
    expect(det.onProximity(true, 1000)).toBeNull();
    const rep = det.onProximity(false, 1500);
    expect(rep).not.toBeNull();
    expect(rep!.index).toBe(1);
    expect(rep!.source).toBe('proximity');
    expect(det.count).toBe(1);
  });

  it('does not count far -> near', () => {
    const det = new RepDetector();
    det.onProximity(true, 1000);
    expect(det.count).toBe(0);
  });

  it('ignores duplicate events', () => {
    const det = new RepDetector();
    det.onProximity(true, 1000);
    det.onProximity(true, 1100);
    det.onProximity(false, 1500);
    det.onProximity(false, 1600);
    expect(det.count).toBe(1);
  });

  it('debounces reps closer than minRepIntervalMs (0.4 s)', () => {
    const det = new RepDetector();
    det.onProximity(true, 0);
    det.onProximity(false, 500); // rep 1
    det.onProximity(true, 600);
    expect(det.onProximity(false, 800)).toBeNull(); // only 300 ms after rep 1 -> bounce
    det.onProximity(true, 1500);
    expect(det.onProximity(false, 2000)).not.toBeNull(); // rep 2
    expect(det.count).toBe(2);
  });

  it('ignores very short near glitches', () => {
    const det = new RepDetector({ minNearDurationMs: 80 });
    det.onProximity(true, 1000);
    expect(det.onProximity(false, 1030)).toBeNull();
    expect(det.count).toBe(0);
  });

  it('counts a steady set of 10 pushups', () => {
    const det = new RepDetector();
    for (let i = 0; i < 10; i++) {
      det.onProximity(true, i * 1500 + 700);
      det.onProximity(false, i * 1500 + 1000);
    }
    expect(det.count).toBe(10);
    expect(det.reps.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('without face tracking every proximity rep is Full (fallback)', () => {
    const det = new RepDetector();
    det.onProximity(true, 0);
    const rep = det.onProximity(false, 600)!;
    expect(rep.quality).toBe('full');
    expect(rep.rangeOfMotion).toBeNull();
    expect(rep.faceLostAtBottom).toBe(true);
  });
});

describe('RepDetector - depth measurement with proximity', () => {
  it('records bottom/top/ROM for a proximity rep', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [0.5, 0.5, 0.5], 0);
    ({ t } = feedFace(det, ramp(0.5, 0.15, 15), t));
    det.onProximity(true, t);
    ({ t } = feedFace(det, [0.15, 0.15, 0.15], t));
    const rep = det.onProximity(false, t)!;
    expect(rep.quality).toBe('full');
    expect(rep.bottomDistance).toBeCloseTo(0.15, 2);
    expect(rep.topDistance).toBeCloseTo(0.5, 2);
    expect(rep.rangeOfMotion).toBeCloseTo(0.35, 2);
    expect(rep.depthRatio).toBeGreaterThan(0.8);
    expect(rep.faceLostAtBottom).toBe(false);
  });

  it('face lost at the bottom: proximity still counts it as Full', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, ramp(0.5, 0.3, 10), 0);
    ({ t } = feedFace(det, [null, null, null], t)); // tracking dropped (face too close)
    det.onProximity(true, t);
    ({ t } = feedFace(det, [null, null, null, null], t));
    const rep = det.onProximity(false, t + 100)!;
    expect(rep).not.toBeNull();
    expect(rep.quality).toBe('full');
    expect(rep.faceLostAtBottom).toBe(true);
    expect(rep.depthRatio).toBeGreaterThanOrEqual(0.7);
  });

  it('when proximityImpliesFull=false, scores proximity reps by depth', () => {
    const det = new RepDetector({ proximityImpliesFull: false }, cal);
    let { t } = feedFace(det, ramp(0.5, 0.3, 10), 0); // ratio (0.5-0.3)/0.42 = 0.48 -> good
    det.onProximity(true, t);
    ({ t } = feedFace(det, Array(6).fill(0.3), t));
    const rep = det.onProximity(false, t)!;
    expect(rep.quality).toBe('good');
  });

  it('median smoothing rejects a single-sample spike in the minimum', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [0.5, 0.5, 0.5, 0.45, 0.05, 0.44, 0.3, 0.2, 0.2], 0);
    det.onProximity(true, t);
    ({ t } = feedFace(det, Array(6).fill(0.2), t));
    const rep = det.onProximity(false, t)!;
    expect(rep.bottomDistance).toBeCloseTo(0.2, 2);
  });
});

describe('RepDetector - depth-only counting', () => {
  const descendAndReturn = (bottom: number) => [...ramp(0.5, bottom, 12), ...Array(3).fill(bottom), ...ramp(bottom, 0.5, 12)];

  it('is off by default: no proximity -> no rep', () => {
    const det = new RepDetector({}, cal);
    const { reps } = feedFace(det, descendAndReturn(0.15), 0);
    expect(reps).toHaveLength(0);
  });

  it('counts and scores reps from depth alone when enabled', () => {
    const det = new RepDetector({ depthOnlyCounting: true }, cal);
    let t = 0;
    const r1 = feedFace(det, descendAndReturn(0.15), t); // ratio ~0.83 -> full
    t = r1.t;
    const r2 = feedFace(det, descendAndReturn(0.28), t); // ratio ~0.52 -> good
    t = r2.t;
    const r3 = feedFace(det, descendAndReturn(0.36), t); // ratio ~0.33 -> shallow
    t = r3.t;
    const r4 = feedFace(det, descendAndReturn(0.42), t); // ratio ~0.19 -> not counted
    const qualities = [...r1.reps, ...r2.reps, ...r3.reps, ...r4.reps].map((r) => r.quality);
    expect(qualities).toEqual(['full', 'good', 'shallow']);
    expect(det.reps.every((r) => r.source === 'depth')).toBe(true);
  });

  it('requires calibration', () => {
    const det = new RepDetector({ depthOnlyCounting: true });
    const { reps } = feedFace(det, descendAndReturn(0.15), 0);
    expect(reps).toHaveLength(0);
  });

  it('does not double count when proximity also fires', () => {
    const det = new RepDetector({ depthOnlyCounting: true }, cal);
    let { t } = feedFace(det, ramp(0.5, 0.15, 12), 0);
    det.onProximity(true, t);
    ({ t } = feedFace(det, Array(6).fill(0.15), t));
    expect(det.onProximity(false, t)).not.toBeNull();
    const { reps } = feedFace(det, ramp(0.15, 0.5, 12), t + 33);
    expect(reps).toHaveLength(0);
    expect(det.count).toBe(1);
    expect(det.reps[0].source).toBe('proximity');
  });

  it('a short proximity glitch does not block a depth-only rep', () => {
    const det = new RepDetector({ depthOnlyCounting: true }, cal);
    let { t } = feedFace(det, ramp(0.5, 0.2, 12), 0);
    det.onProximity(true, t);
    det.onProximity(false, t + 20);
    const { reps } = feedFace(det, ramp(0.2, 0.5, 12), t + 40);
    expect(reps).toHaveLength(1);
    expect(reps[0].source).toBe('depth');
  });

  it('reset clears everything', () => {
    const det = new RepDetector({ depthOnlyCounting: true }, cal);
    feedFace(det, descendAndReturn(0.15), 0);
    expect(det.count).toBe(1);
    det.reset();
    expect(det.count).toBe(0);
    expect(det.reps).toHaveLength(0);
  });
});
