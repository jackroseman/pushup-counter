/**
 * The preview's sensor simulator must produce signals the app's real rep counter counts exactly,
 * or recordings would show wrong numbers. Feeds the simulator waveform into RepDetector.
 */
import { RepDetector } from '../../../src/core';
import { DEFAULT_SIM_STATE, FACE_INTERVAL_MS, SimState, completedReps, endOfCurrentRep, faceDistanceAt, gravityFor } from '../simulator/signals';

function countReps(state: SimState, untilMs: number): number {
  const det = new RepDetector({}, { topDistance: state.topM });
  for (let t = 0; t <= untilMs; t += FACE_INTERVAL_MS) det.onFaceDistance(faceDistanceAt(state, t), true, t);
  return det.count;
}

describe('preview sensor simulator', () => {
  it.each([
    [7, 1100],
    [38, 900],
    [5, 2200],
  ])('%i push-ups at %i ms each are counted as exactly that many', (count, periodMs) => {
    const state: SimState = { ...DEFAULT_SIM_STATE, periodMs, repsStartedAt: 1000, repsEndAt: 1000 + count * periodMs };
    const end = 1000 + count * periodMs + 2000;
    expect(completedReps(state, end)).toBe(count);
    expect(countReps(state, end)).toBe(count);
  });

  it('holds at the top while reps are off', () => {
    expect(faceDistanceAt(DEFAULT_SIM_STATE, 5000)).toBe(DEFAULT_SIM_STATE.topM);
    expect(countReps(DEFAULT_SIM_STATE, 10000)).toBe(0);
  });

  it('stopping mid push-up finishes that push-up first', () => {
    const state: SimState = { ...DEFAULT_SIM_STATE, periodMs: 1000, repsStartedAt: 0 };
    state.repsEndAt = endOfCurrentRep(state, 3400);
    expect(state.repsEndAt).toBe(4000);
    expect(countReps(state, 7000)).toBe(4);
  });

  it('reports flat, lean and tilt on the right side of the app thresholds (8° ready, 15° moved)', () => {
    const deg = (g: { x: number; y: number; z: number }) => (Math.acos(-g.z / Math.hypot(g.x, g.y, g.z)) * 180) / Math.PI;
    expect(deg(gravityFor('flat'))).toBeLessThan(8);
    expect(deg(gravityFor('lean'))).toBeGreaterThan(8);
    expect(deg(gravityFor('lean'))).toBeLessThan(15);
    expect(deg(gravityFor('tilt'))).toBeGreaterThan(15);
  });
});
