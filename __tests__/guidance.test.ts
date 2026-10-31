import {
  CalibrationGuide,
  DEFAULT_GUIDANCE_OPTIONS,
  HoldTracker,
  PoseSample,
  evaluatePose,
  offsetAngles,
} from '../src/core';

const good = (t: number, distance = 0.45, extra: Partial<PoseSample> = {}): PoseSample => ({
  t,
  tracked: true,
  distance,
  offsetX: 0,
  offsetY: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  ...extra,
});

describe('evaluatePose', () => {
  it('reports a missing face first', () => {
    expect(evaluatePose(null).hint).toBe('find-face');
    const g = evaluatePose({ t: 0, tracked: false, distance: 0 });
    expect(g.face).toBe('bad');
    expect(g.ok).toBe(false);
  });

  it('passes a centered, level face at plank-top distance', () => {
    const g = evaluatePose(good(0));
    expect(g).toMatchObject({ face: 'ok', distance: 'ok', centered: 'ok', angle: 'ok', ok: true, hint: null });
  });

  it('flags too close / too far', () => {
    expect(evaluatePose(good(0, 0.18)).hint).toBe('too-close');
    expect(evaluatePose(good(0, 0.95)).hint).toBe('too-far');
    expect(evaluatePose(good(0, 0.18)).distance).toBe('bad');
  });

  it('gives the direction to move along the dominant axis', () => {
    // 45 cm away, 15 cm toward the screen's right edge -> ~19 deg off axis
    expect(evaluatePose(good(0, 0.45, { offsetX: 0.15 })).hint).toBe('shift-left');
    expect(evaluatePose(good(0, 0.45, { offsetX: -0.15 })).hint).toBe('shift-right');
    expect(evaluatePose(good(0, 0.45, { offsetY: 0.15, offsetX: 0.05 })).hint).toBe('shift-back');
    expect(evaluatePose(good(0, 0.45, { offsetY: -0.15 })).hint).toBe('shift-forward');
    // small offsets are within tolerance
    expect(evaluatePose(good(0, 0.45, { offsetX: 0.05, offsetY: 0.04 })).centered).toBe('ok');
  });

  it('checks head angle', () => {
    expect(evaluatePose(good(0, 0.45, { pitch: 35 })).hint).toBe('look-down');
    expect(evaluatePose(good(0, 0.45, { pitch: -30 })).hint).toBe('look-down');
    expect(evaluatePose(good(0, 0.45, { yaw: 30 })).hint).toBe('face-phone');
    expect(evaluatePose(good(0, 0.45, { pitch: 15, yaw: -10 })).angle).toBe('ok');
  });

  it('prioritises distance over centering over angle', () => {
    expect(evaluatePose(good(0, 0.1, { offsetX: 0.2, pitch: 50 })).hint).toBe('too-close');
    expect(evaluatePose(good(0, 0.45, { offsetX: 0.2, pitch: 50 })).hint).toBe('shift-left');
  });

  it('treats missing pose data as unknown, not failing', () => {
    const g = evaluatePose({ t: 0, tracked: true, distance: 0.45 });
    expect(g).toMatchObject({ centered: 'unknown', angle: 'unknown', ok: true });
  });

  it('offsetAngles uses depth along the axis', () => {
    const a = offsetAngles(good(0, 0.5, { offsetX: 0.3, offsetY: 0 }))!;
    // depth = 0.4 -> atan(0.3/0.4) = 36.87 deg
    expect(a.total).toBeCloseTo(36.87, 1);
    expect(a.x).toBeCloseTo(36.87, 1);
    expect(DEFAULT_GUIDANCE_OPTIONS.maxOffsetDeg).toBeLessThan(a.total);
  });
});

describe('HoldTracker', () => {
  it('fills progress over 2 s while steady', () => {
    const h = new HoldTracker();
    let u = h.add(0, 0.45, true);
    expect(u).toMatchObject({ holding: true, progress: 0, done: false });
    for (let t = 33; t < 1000; t += 33) u = h.add(t, 0.45 + ((t / 33) % 2) * 0.002, true);
    expect(u.progress).toBeGreaterThan(0.45);
    expect(u.progress).toBeLessThan(0.55);
    for (let t = 1000; t <= 2040; t += 33) u = h.add(t, 0.45, true);
    expect(u.done).toBe(true);
    expect(u.progress).toBe(1);
  });

  it('restarts when the distance varies too much', () => {
    const h = new HoldTracker();
    for (let t = 0; t < 1000; t += 33) h.add(t, 0.45, true);
    // big movement: std dev jumps over 1.5 cm
    let u = h.add(1000, 0.45, true);
    for (let i = 0; i < 6 && u.reset !== 'moved'; i++) u = h.add(1033 + i * 33, 0.55, true);
    expect(u.reset).toBe('moved');
    expect(u.progress).toBe(0);
    expect(h.samples.length).toBe(1);
  });

  it('aborts on bad pose, lost face, or a gap', () => {
    const h = new HoldTracker();
    h.add(0, 0.45, true);
    expect(h.add(33, 0.45, false).reset).toBe('pose');
    h.add(66, 0.45, true);
    expect(h.add(99, 0, false, false).reset).toBe('lost');
    h.add(132, 0.45, true);
    const u = h.add(1000, 0.45, true);
    expect(u.reset).toBe('gap');
    expect(u.progress).toBe(0);
  });

  it('a bad pose with no hold in progress is not a reset', () => {
    expect(new HoldTracker().add(0, 0.45, false).reset).toBeNull();
  });
});

describe('CalibrationGuide', () => {
  it('locks in the median top distance after a steady, well-posed 2 s hold', () => {
    const g = new CalibrationGuide();
    let snap = g.add({ t: 0, tracked: false, distance: 0 });
    expect(snap.pose.hint).toBe('find-face');
    // first, too close: no progress
    for (let t = 0; t < 500; t += 33) snap = g.add(good(t, 0.2));
    expect(snap.progress).toBe(0);
    expect(snap.message).toMatch(/Too close/);
    // then a good hold
    for (let t = 500; t <= 2600 && !snap.result; t += 33) snap = g.add(good(t, 0.42 + (t % 66 ? 0.002 : -0.002)));
    expect(snap.result).not.toBeNull();
    expect(snap.result!.calibration.topDistance).toBeCloseTo(0.42, 2);
    expect(snap.message).toBe('Locked: top at 42 cm');
    expect(g.locked).toBe(true);
    // further samples do not change the lock
    expect(g.add(good(3000, 0.6)).result!.calibration.topDistance).toBeCloseTo(0.42, 2);
  });

  it('a pose problem mid-hold restarts the progress', () => {
    const g = new CalibrationGuide();
    let snap = g.add(good(0));
    for (let t = 33; t < 1200; t += 33) snap = g.add(good(t));
    expect(snap.progress).toBeGreaterThan(0.5);
    snap = g.add(good(1233, 0.45, { pitch: 40 }));
    expect(snap.progress).toBe(0);
    expect(snap.pose.hint).toBe('look-down');
    snap = g.add(good(1266));
    expect(snap.lastReset).toBe('pose');
    expect(snap.message).toMatch(/Lost position/);
    expect(snap.result).toBeNull();
  });

  it('shows a "you moved" message after movement restarts the hold', () => {
    const g = new CalibrationGuide();
    let snap = g.add(good(0));
    for (let t = 33; t < 900; t += 33) snap = g.add(good(t, 0.45));
    for (let i = 0; i < 8 && snap.lastReset !== 'moved'; i++) snap = g.add(good(900 + i * 33, 0.56));
    expect(snap.lastReset).toBe('moved');
    expect(snap.message).toMatch(/You moved/);
  });
});
