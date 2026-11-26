import { LOCK_SETTLE } from '../src/components/level';
import { createReduceMotionStore, motionSpec, rollDirection, sweepTarget } from '../src/ui/motion';
import { motion } from '../src/ui/tokens';

describe('motion tokens (plan PR 14)', () => {
  it('uses the planned durations', () => {
    expect(motion.press).toBe(120);
    expect(motion.pressScale).toBe(0.98);
    expect(motion.ring).toBe(600);
    expect(motion.roll).toBe(180);
    expect(motion.sweep).toBe(1000);
  });
});

describe('motionSpec: the Reduce Motion switch', () => {
  it('moves with the planned durations when Reduce Motion is off', () => {
    expect(motionSpec('press', false)).toMatchObject({ duration: 120, move: true });
    expect(motionSpec('ring', false)).toMatchObject({ duration: 600, move: true });
    expect(motionSpec('roll', false)).toMatchObject({ duration: 180, move: true });
    expect(motionSpec('lock', false)).toMatchObject({ duration: motion.lock, move: true });
    expect(motionSpec('sweep', false)).toMatchObject({ duration: 1000, move: true });
    expect(motionSpec('fade', false)).toMatchObject({ duration: motion.fade, move: true });
  });

  it('never moves when Reduce Motion is on', () => {
    for (const kind of ['press', 'ring', 'roll', 'lock', 'sweep', 'fade'] as const) {
      expect(motionSpec(kind, true).move).toBe(false);
    }
  });

  it('turns the ring fill and the 3-2-1 sweep into jumps, and the rest into short crossfades', () => {
    expect(motionSpec('ring', true).duration).toBe(0);
    expect(motionSpec('sweep', true).duration).toBe(0);
    for (const kind of ['roll', 'lock', 'fade'] as const) {
      expect(motionSpec(kind, true).duration).toBe(motion.crossfade);
    }
  });

  it('the sweep is linear and the others ease out', () => {
    expect(motionSpec('sweep', false).easing(0.5)).toBe(0.5);
    expect(motionSpec('ring', false).easing(0.5)).toBeGreaterThan(0.5);
  });
});

describe('Reduce Motion store', () => {
  function fakeInfo(initial: boolean) {
    let handler: ((v: boolean) => void) | null = null;
    return {
      info: {
        isReduceMotionEnabled: jest.fn(() => Promise.resolve(initial)),
        addEventListener: jest.fn((_: string, h: (v: boolean) => void) => {
          handler = h;
          return { remove: jest.fn() };
        }),
      } as never,
      emit: (v: boolean) => handler?.(v),
    };
  }

  it('reads the system setting once started', async () => {
    const { info } = fakeInfo(true);
    const store = createReduceMotionStore(info);
    expect(store.get()).toBe(false);
    store.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get()).toBe(true);
  });

  it('follows changes and tells subscribers', () => {
    const { info, emit } = fakeInfo(false);
    const store = createReduceMotionStore(info);
    store.start();
    const seen = jest.fn();
    const off = store.subscribe(seen);
    emit(true);
    expect(store.get()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    emit(true);
    expect(seen).toHaveBeenCalledTimes(1);
    emit(false);
    expect(store.get()).toBe(false);
    off();
    emit(true);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('starts only once', () => {
    const { info } = fakeInfo(false);
    const store = createReduceMotionStore(info);
    store.start();
    store.start();
    expect((info as { addEventListener: jest.Mock }).addEventListener).toHaveBeenCalledTimes(1);
  });
});

describe('3-2-1 sweep and count roll helpers', () => {
  it('each second sweeps to the next step; the last one ends empty', () => {
    expect(sweepTarget(3, 3)).toBeCloseTo(2 / 3);
    expect(sweepTarget(2, 3)).toBeCloseTo(1 / 3);
    expect(sweepTarget(1, 3)).toBe(0);
  });

  it('is safe for odd input', () => {
    expect(sweepTarget(3, 0)).toBe(0);
    expect(sweepTarget(0, 3)).toBe(0);
  });

  it('rolls up when the count goes up and down when it resets', () => {
    expect(rollDirection(4, 5)).toBe(1);
    expect(rollDirection(5, 0)).toBe(-1);
    expect(rollDirection(5, 5)).toBe(1);
  });

  it('the level settle is small', () => {
    expect(LOCK_SETTLE).toBeGreaterThan(0);
    expect(LOCK_SETTLE).toBeLessThan(16);
  });
});
