import { DEFAULT_TILT_OPTIONS, TiltMonitor, tiltDegrees } from '../src/core/tilt';

const DEG = Math.PI / 180;
/** Gravity for a phone tilted `deg` from flat, screen up (tilted about the x axis). */
const g = (deg: number) => ({ x: 0, y: -Math.sin(deg * DEG), z: -Math.cos(deg * DEG) });
/** Feed samples every `stepMs` from t0 for durationMs at a fixed tilt. Returns the last snapshot. */
function feed(m: TiltMonitor, deg: number, t0: number, durationMs: number, stepMs = 20) {
  let snap = m.snapshot;
  for (let t = t0; t <= t0 + durationMs; t += stepMs) snap = m.add({ t, ...g(deg) });
  return snap;
}

describe('tiltDegrees', () => {
  it('is 0 flat screen up, 90 on edge, 180 face down', () => {
    expect(tiltDegrees({ x: 0, y: 0, z: -1 })).toBeCloseTo(0);
    expect(tiltDegrees({ x: 1, y: 0, z: 0 })).toBeCloseTo(90);
    expect(tiltDegrees({ x: 0, y: 0, z: 1 })).toBeCloseTo(180);
  });

  it('does not depend on the gravity magnitude or yaw', () => {
    expect(tiltDegrees({ x: 0, y: -0.5 * Math.sin(10 * DEG), z: -0.5 * Math.cos(10 * DEG) })).toBeCloseTo(10);
    expect(tiltDegrees({ x: Math.sin(10 * DEG), y: 0, z: -Math.cos(10 * DEG) })).toBeCloseTo(10);
  });

  it('rejects unusable samples', () => {
    expect(tiltDegrees({ x: NaN, y: 0, z: -1 })).toBeNull();
    expect(tiltDegrees({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('TiltMonitor ready', () => {
  it('needs 500 ms at <= 8 degrees', () => {
    const m = new TiltMonitor();
    expect(feed(m, 5, 0, 480).ready).toBe(false);
    const s = m.add({ t: 500, ...g(5) });
    expect(s.ready).toBe(true);
    expect(s.readyProgress).toBe(1);
    expect(s.flat).toBe(true);
  });

  it('accepts exactly 8 degrees, not 9', () => {
    expect(feed(new TiltMonitor(), 8, 0, 600).ready).toBe(true);
    expect(feed(new TiltMonitor(), 9, 0, 2000).ready).toBe(false);
  });

  it('restarts the hold when the phone leaves flat', () => {
    const m = new TiltMonitor();
    feed(m, 3, 0, 400);
    m.add({ t: 420, ...g(12) });
    expect(m.snapshot.readyProgress).toBe(0);
    expect(feed(m, 3, 440, 400).ready).toBe(false);
    expect(feed(m, 3, 860, 100).ready).toBe(true);
  });

  it('restarts the hold after a gap in samples', () => {
    const m = new TiltMonitor();
    feed(m, 2, 0, 400);
    m.add({ t: 1000, ...g(2) });
    expect(m.snapshot.ready).toBe(false);
    expect(m.snapshot.readyProgress).toBe(0);
  });

  it('a face-down phone is never ready', () => {
    const m = new TiltMonitor();
    let s = m.snapshot;
    for (let t = 0; t <= 1000; t += 20) s = m.add({ t, x: 0, y: 0, z: 1 });
    expect(s.ready).toBe(false);
    expect(s.screenUp).toBe(false);
    expect(s.tripped).toBe(true);
  });
});

describe('TiltMonitor trip', () => {
  it('trips after 200 ms above 15 degrees', () => {
    const m = new TiltMonitor();
    feed(m, 2, 0, 600);
    expect(feed(m, 30, 620, 180).tripped).toBe(false);
    expect(m.add({ t: 820, ...g(30) }).tripped).toBe(true);
  });

  it('ignores a short blip', () => {
    const m = new TiltMonitor();
    feed(m, 2, 0, 600);
    feed(m, 40, 620, 100);
    expect(feed(m, 2, 740, 1000).tripped).toBe(false);
  });

  it('never trips between the thresholds (floor wobble, sloped floor)', () => {
    const m = new TiltMonitor();
    feed(m, 2, 0, 600);
    expect(feed(m, 14, 620, 5000).tripped).toBe(false);
    expect(feed(m, 15, 5640, 5000).tripped).toBe(false);
  });

  it('stays tripped until reset', () => {
    const m = new TiltMonitor();
    feed(m, 60, 0, 300);
    expect(m.snapshot.tripped).toBe(true);
    expect(feed(m, 0, 320, 1000).tripped).toBe(true);
    m.reset();
    expect(m.snapshot.tripped).toBe(false);
    expect(m.snapshot.ready).toBe(false);
    expect(feed(m, 0, 2000, 600).ready).toBe(true);
  });

  it('does not count the hold across a gap', () => {
    const m = new TiltMonitor();
    m.add({ t: 0, ...g(40) });
    m.add({ t: 1000, ...g(40) });
    expect(m.snapshot.tripped).toBe(false);
  });

  it('ignores bad samples without changing state', () => {
    const m = new TiltMonitor();
    feed(m, 1, 0, 600);
    const before = m.snapshot;
    expect(m.add({ t: 620, x: NaN, y: 0, z: -1 })).toBe(before);
  });

  it('uses the documented defaults', () => {
    expect(DEFAULT_TILT_OPTIONS).toMatchObject({ readyMaxDeg: 8, readyHoldMs: 500, tripMinDeg: 15, tripHoldMs: 200 });
  });

  it('bubble follows gravity x / y, clamped', () => {
    const m = new TiltMonitor();
    const s = m.add({ t: 0, x: 0.2, y: -0.1, z: -0.97 });
    expect(s.bubbleX).toBeCloseTo(0.2);
    expect(s.bubbleY).toBeCloseTo(-0.1);
  });
});
