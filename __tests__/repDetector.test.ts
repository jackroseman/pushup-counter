import { RepDetector, Rep } from '../src/core';

const TOP = 0.5;
const cal = { topDistance: TOP };
const DT = 33;

/** Feed a face-distance trajectory at ~30 Hz starting at t0; returns completed reps and end time. */
function feedFace(det: RepDetector, distances: (number | null)[], t0: number, dtMs = DT): { reps: Rep[]; t: number } {
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

const hold = (d: number, n: number) => Array(n).fill(d);
const pushup = (bottom: number, down = 12, up = 12) => [...ramp(TOP, bottom, down), ...hold(bottom, 3), ...ramp(bottom, TOP, up)];

describe('RepDetector - depth counting (the only mode)', () => {
  it('counts and scores reps from face distance alone', () => {
    const det = new RepDetector({}, cal);
    let t = 0;
    const all: Rep[] = [];
    for (const bottom of [0.15, 0.28, 0.36, 0.42]) {
      const r = feedFace(det, [...hold(TOP, 5), ...pushup(bottom)], t);
      all.push(...r.reps);
      t = r.t;
    }
    // ratios ~0.83 full, ~0.52 good, ~0.33 shallow, ~0.19 too shallow -> not counted
    expect(all.map((r) => r.quality)).toEqual(['full', 'good', 'shallow']);
    expect(all.every((r) => r.source === 'depth')).toBe(true);
    expect(det.count).toBe(3);
  });

  it('requires calibration', () => {
    const det = new RepDetector();
    const { reps } = feedFace(det, pushup(0.15), 0);
    expect(reps).toHaveLength(0);
  });

  it('proximity alone never counts a rep', () => {
    const det = new RepDetector({}, cal);
    det.onProximity(true, 0);
    det.onProximity(false, 600);
    expect(det.count).toBe(0);
  });

  it('records rep timing: descent, ascent, interval', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, hold(TOP, 5), 0);
    const r1 = feedFace(det, pushup(0.15, 15, 10), t);
    ({ t } = r1);
    ({ t } = feedFace(det, hold(TOP, 10), t));
    const r2 = feedFace(det, pushup(0.15, 15, 10), t);
    const [a] = r1.reps;
    const [b] = r2.reps;
    expect(a.intervalMs).toBeNull();
    // ~15 samples down (+ smoothing lag), ~10 up
    expect(a.descentMs!).toBeGreaterThan(400);
    expect(a.descentMs!).toBeLessThan(700);
    expect(a.ascentMs!).toBeGreaterThan(250);
    expect(a.ascentMs!).toBeLessThan(600);
    expect(a.startedAt!).toBeLessThan(a.bottomAt!);
    expect(b.intervalMs).toBe(b.timestamp - a.timestamp);
    expect(b.intervalMs!).toBeGreaterThan(1000);
  });

  it('debounces reps closer than minRepIntervalMs', () => {
    const det = new RepDetector({ minRepIntervalMs: 2000 }, cal);
    let { t } = feedFace(det, hold(TOP, 3), 0);
    const r1 = feedFace(det, pushup(0.15, 5, 5), t);
    const r2 = feedFace(det, pushup(0.15, 5, 5), r1.t);
    expect(r1.reps).toHaveLength(1);
    expect(r2.reps).toHaveLength(0);
  });

  it('median smoothing rejects a single-sample spike', () => {
    const det = new RepDetector({}, cal);
    const { reps } = feedFace(det, [0.5, 0.5, 0.5, 0.45, 0.05, 0.44, 0.3, 0.2, 0.2, 0.2, ...ramp(0.2, 0.5, 10)], 0);
    expect(reps).toHaveLength(1);
    expect(reps[0].bottomDistance).toBeCloseTo(0.2, 2);
  });
});

describe('RepDetector - proximity as a supporting signal', () => {
  it('chest touch marks the rep Full and does not double count', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [...hold(TOP, 3), ...ramp(TOP, 0.3, 10)], 0); // ratio ~0.48 -> would be Good
    det.onProximity(true, t);
    ({ t } = feedFace(det, hold(0.3, 6), t));
    det.onProximity(false, t);
    const { reps } = feedFace(det, ramp(0.3, TOP, 10), t + DT);
    expect(reps).toHaveLength(1);
    expect(reps[0].quality).toBe('full');
    expect(reps[0].proximityTouched).toBe(true);
    expect(det.count).toBe(1);
  });

  it('face lost at the bottom + chest touch: counts as Full when the face comes back up', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [...hold(TOP, 3), ...ramp(TOP, 0.42, 6)], 0); // shallow before losing the face
    ({ t } = feedFace(det, [null, null], t));
    det.onProximity(true, t);
    ({ t } = feedFace(det, [null, null, null, null], t));
    det.onProximity(false, t);
    ({ t } = feedFace(det, [null], t));
    const { reps } = feedFace(det, ramp(0.35, TOP, 8), t);
    expect(reps).toHaveLength(1);
    expect(reps[0].quality).toBe('full');
    expect(reps[0].faceLostAtBottom).toBe(true);
    expect(reps[0].depthRatio!).toBeGreaterThanOrEqual(0.7);
    expect(reps[0].bottomAt).not.toBeNull();
  });

  it('waits for proximity to clear before completing (no lost rep)', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [...hold(TOP, 3), ...ramp(TOP, 0.15, 10)], 0);
    det.onProximity(true, t);
    ({ t } = feedFace(det, ramp(0.15, TOP, 10), t)); // back at top while sensor still "near"
    expect(det.count).toBe(0);
    det.onProximity(false, t);
    const { reps } = feedFace(det, hold(TOP, 2), t);
    expect(reps).toHaveLength(1);
  });

  it('a short proximity glitch is ignored', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [...hold(TOP, 3), ...ramp(TOP, 0.42, 10)], 0); // too shallow to count
    det.onProximity(true, t);
    det.onProximity(false, t + 20);
    const { reps } = feedFace(det, ramp(0.42, TOP, 10), t + 40);
    expect(reps).toHaveLength(0);
  });

  it('without proximity, losing the face at the bottom still counts once if deep enough', () => {
    const det = new RepDetector({}, cal);
    let { t } = feedFace(det, [...hold(TOP, 3), ...ramp(TOP, 0.25, 10)], 0); // ratio ~0.6 -> good
    ({ t } = feedFace(det, [null, null, null, null], t));
    const { reps } = feedFace(det, ramp(0.3, TOP, 10), t);
    expect(reps).toHaveLength(1);
    expect(reps[0].quality).toBe('good');
    expect(reps[0].faceLostAtBottom).toBe(true);
  });

  it('reset clears everything', () => {
    const det = new RepDetector({}, cal);
    feedFace(det, [...hold(TOP, 3), ...pushup(0.15)], 0);
    expect(det.count).toBe(1);
    det.reset();
    expect(det.count).toBe(0);
    expect(det.reps).toHaveLength(0);
  });
});
