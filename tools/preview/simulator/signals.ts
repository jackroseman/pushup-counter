/**
 * The preview sensor simulator's signal model, as pure functions (no timers, no DOM), so the
 * waveform can be unit-tested against the real rep counter (see ../__tests__).
 *
 * The real app gets two streams from the native PushupSensors module:
 *  - onFaceDistance: ARKit face-to-camera distance in meters (~30 Hz)
 *  - onGravity: Core Motion gravity vector in g (~20 Hz); flat, screen up = (0, 0, -1)
 * The simulator produces the same events from a small state object the preview driver (or you,
 * from the browser console) changes at any time.
 */

export type SimPhone = 'flat' | 'lean' | 'tilt';

export interface SimState {
  /** Gravity the phone reports. flat = ready to count (<8°); lean = ~11°, not flat yet; tilt = ~25°, picked up / moved. */
  phone: SimPhone;
  /** Gravity samples arrive slowly (700 ms apart), so the level step never locks. Freezes "Lay your phone flat". */
  stalled: boolean;
  /** Whether ARKit "sees" a face. false = face lost. */
  faceTracked: boolean;
  /** performance.now() when reps started, or null while holding the top position. */
  repsStartedAt: number | null;
  /** performance.now() when the last rep ends (back at the top), or null to keep going. */
  repsEndAt: number | null;
  /** Length of one push-up (top -> bottom -> top) in ms. */
  periodMs: number;
  /** Face distance at the top position, meters. */
  topM: number;
  /** How far the face travels down at the bottom, meters (0.27 of 0.42 = a "full" rep). */
  depthM: number;
}

export const DEFAULT_SIM_STATE: SimState = {
  phone: 'flat',
  stalled: false,
  faceTracked: true,
  repsStartedAt: null,
  repsEndAt: null,
  periodMs: 2200,
  topM: 0.42,
  depthM: 0.27,
};

export const FACE_INTERVAL_MS = 33;
export const GRAVITY_INTERVAL_MS = 50;
export const STALLED_GRAVITY_INTERVAL_MS = 700;

/** Face distance at time `nowMs` (performance.now() clock). A smooth cosine dip per rep. */
export function faceDistanceAt(state: SimState, nowMs: number, jitter = 0): number {
  let d = state.topM;
  const moving = state.repsStartedAt !== null && nowMs > state.repsStartedAt && (state.repsEndAt === null || nowMs < state.repsEndAt);
  if (moving && state.repsStartedAt !== null) {
    const phase = ((nowMs - state.repsStartedAt) % state.periodMs) / state.periodMs;
    d = state.topM - state.depthM * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
  }
  return d + jitter;
}

/** Reps completed so far by the waveform (each full period is one rep). */
export function completedReps(state: SimState, nowMs: number): number {
  if (state.repsStartedAt === null || nowMs <= state.repsStartedAt) return 0;
  const until = state.repsEndAt === null ? nowMs : Math.min(nowMs, state.repsEndAt);
  return Math.floor((until - state.repsStartedAt + 1e-6) / state.periodMs);
}

/** End time that finishes the push-up in progress at `nowMs` (so stopping never cuts a rep short). */
export function endOfCurrentRep(state: SimState, nowMs: number): number | null {
  if (state.repsStartedAt === null) return null;
  const done = Math.ceil((nowMs - state.repsStartedAt) / state.periodMs);
  return state.repsStartedAt + Math.max(done, 0) * state.periodMs;
}

export function gravityFor(phone: SimPhone): { x: number; y: number; z: number } {
  switch (phone) {
    case 'tilt':
      return { x: 0.38, y: 0.22, z: -0.9 };
    case 'lean':
      return { x: 0.16, y: 0.11, z: -0.98 }; // ~11°: not flat enough to start (8°), not "moved" (15°)
    default:
      return { x: 0.005, y: 0.004, z: -1 };
  }
}

export function gravityIntervalMs(state: SimState): number {
  return state.stalled ? STALLED_GRAVITY_INTERVAL_MS : GRAVITY_INTERVAL_MS;
}
