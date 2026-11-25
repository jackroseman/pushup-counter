/**
 * Flat-phone check (pure, unit-tested). The set needs the phone flat on the floor, screen up:
 * face-distance calibration is only accurate while the phone stays put, and picking it up means
 * the hands are off the ground.
 *
 * Only tilt is used, never acceleration, so floor vibration from a hard rep can't end a set.
 * Tilt is the angle between "straight down" and the back of the phone:
 *   tiltDeg = acos(-gz / |g|)   0° = flat, screen up · 90° = on its edge · 180° = face down
 *
 * Two thresholds with a gap (hysteresis):
 *   ready:   tilt <= READY_MAX_DEG continuously for READY_HOLD_MS  -> placement accepted
 *   tripped: tilt >  TRIP_MIN_DEG  continuously for TRIP_HOLD_MS   -> phone moved
 * Between the two nothing happens. TRIP_HOLD_MS ignores a one-sample blip but is shorter than
 * minRepIntervalMs (400), so no extra rep can complete while the phone is being lifted.
 */

export interface GravitySample {
  /** ms (Date.now() base) */
  t: number;
  /** Gravity in g, device frame (+z out of the screen). */
  x: number;
  y: number;
  z: number;
}

export interface TiltOptions {
  readyMaxDeg: number;
  readyHoldMs: number;
  tripMinDeg: number;
  tripHoldMs: number;
  /** A gap without samples longer than this restarts both holds (ms). */
  maxGapMs: number;
}

export const DEFAULT_TILT_OPTIONS: TiltOptions = {
  readyMaxDeg: 8,
  readyHoldMs: 500,
  tripMinDeg: 15,
  tripHoldMs: 200,
  maxGapMs: 500,
};

/** Sample rate asked of the native module (Hz). */
export const GRAVITY_HZ = 50;

const DEG = 180 / Math.PI;

/** Tilt from flat, screen up, in degrees (0..180). Null for an unusable sample. */
export function tiltDegrees(g: { x: number; y: number; z: number }): number | null {
  if (![g.x, g.y, g.z].every(Number.isFinite)) return null;
  const norm = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
  if (norm < 0.2) return null;
  return Math.acos(Math.max(-1, Math.min(1, -g.z / norm))) * DEG;
}

export interface TiltSnapshot {
  /** Latest tilt (degrees), null before the first usable sample. */
  tiltDeg: number | null;
  /** Screen faces up (tilt under 90°). */
  screenUp: boolean;
  /** Within the ready threshold right now. */
  flat: boolean;
  /** 0..1 progress of the ready hold. */
  readyProgress: number;
  /** Held flat long enough. Latched until reset(). */
  ready: boolean;
  /** Tilted past the trip threshold long enough. Latched until reset(). */
  tripped: boolean;
  /** Level bubble offset for the UI, -1..1 on each axis (gravity x / y). */
  bubbleX: number;
  bubbleY: number;
}

export class TiltMonitor {
  private lastT: number | null = null;
  private flatSince: number | null = null;
  private tiltedSince: number | null = null;
  private snap: TiltSnapshot = TiltMonitor.empty();

  constructor(private readonly o: TiltOptions = DEFAULT_TILT_OPTIONS) {}

  private static empty(): TiltSnapshot {
    return { tiltDeg: null, screenUp: false, flat: false, readyProgress: 0, ready: false, tripped: false, bubbleX: 0, bubbleY: 0 };
  }

  get snapshot(): TiltSnapshot {
    return this.snap;
  }

  /** Clears both holds and both latches (e.g. when the user is asked to place the phone again). */
  reset(): void {
    this.lastT = null;
    this.flatSince = null;
    this.tiltedSince = null;
    this.snap = TiltMonitor.empty();
  }

  add(s: GravitySample): TiltSnapshot {
    const tilt = tiltDegrees(s);
    if (tilt === null || !Number.isFinite(s.t)) return this.snap;

    if (this.lastT !== null && (s.t - this.lastT > this.o.maxGapMs || s.t < this.lastT)) {
      // Missing data: start both holds over rather than guess what happened in between.
      this.flatSince = null;
      this.tiltedSince = null;
    }
    this.lastT = s.t;

    const flat = tilt <= this.o.readyMaxDeg;
    if (flat) this.flatSince ??= s.t;
    else this.flatSince = null;

    if (tilt > this.o.tripMinDeg) this.tiltedSince ??= s.t;
    else this.tiltedSince = null;

    const readyProgress =
      this.flatSince === null ? 0 : this.o.readyHoldMs <= 0 ? 1 : Math.min(1, (s.t - this.flatSince) / this.o.readyHoldMs);
    const ready = this.snap.ready || readyProgress >= 1;
    const tripped = this.snap.tripped || (this.tiltedSince !== null && s.t - this.tiltedSince >= this.o.tripHoldMs);

    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.snap = {
      tiltDeg: tilt,
      screenUp: tilt < 90,
      flat,
      readyProgress,
      ready,
      tripped,
      bubbleX: clamp(s.x),
      bubbleY: clamp(s.y),
    };
    return this.snap;
  }
}
