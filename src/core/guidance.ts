import { CalibrationOptions, CalibrationResult, Calibrator, DEFAULT_CALIBRATION_OPTIONS } from './calibration';

/**
 * Calibration guidance: turns live face-tracking samples (distance + pose) into
 * "is the user in a good top position?" checks, and a hold-still tracker that only
 * lets the existing median-over-2s calibration run while those checks pass.
 * Pure logic (no React / native), so it is unit tested.
 */

/** One face-tracking sample as delivered by the native module. */
export interface PoseSample {
  /** ms (Date.now() base) */
  t: number;
  tracked: boolean;
  /** Face -> camera distance in meters. */
  distance: number;
  /** Offset from the camera axis in meters: +x toward the screen's right edge, +y toward its top edge. */
  offsetX?: number;
  offsetY?: number;
  /** Degrees; 0 = looking straight at the camera. */
  pitch?: number;
  yaw?: number;
  roll?: number;
}

export interface GuidanceOptions {
  /** Plausible face-to-phone distance at the top of a pushup (meters). */
  minTop: number;
  maxTop: number;
  /** Max angle between the camera axis and the face (degrees) to count as centered. */
  maxOffsetDeg: number;
  /** Max head pitch / yaw (degrees) to count as looking at the phone. */
  maxPitchDeg: number;
  maxYawDeg: number;
}

export const DEFAULT_GUIDANCE_OPTIONS: GuidanceOptions = {
  minTop: 0.25,
  maxTop: 0.8,
  maxOffsetDeg: 12,
  maxPitchDeg: 25,
  maxYawDeg: 20,
};

export type CheckState = 'ok' | 'bad' | 'unknown';
export type GuidanceHint =
  | 'find-face'
  | 'too-close'
  | 'too-far'
  | 'shift-left'
  | 'shift-right'
  | 'shift-forward'
  | 'shift-back'
  | 'look-down'
  | 'face-phone'
  | null;

export interface PoseGuidance {
  face: CheckState;
  distance: CheckState;
  centered: CheckState;
  angle: CheckState;
  /** All checks pass (unknown counts as pass for optional pose data). */
  ok: boolean;
  /** The single most important thing to fix, or null when ok. */
  hint: GuidanceHint;
  message: string;
  /** Echo of the useful numbers for the UI. */
  distanceM: number | null;
  offsetDeg: number | null;
}

const DEG = 180 / Math.PI;

export const HINT_MESSAGES: Record<Exclude<GuidanceHint, null>, string> = {
  'find-face': 'Face not found: put your face over the phone',
  'too-close': 'Too close: straighten your arms (top of a pushup)',
  'too-far': 'Too far: get into plank with your face over the phone',
  'shift-left': 'Shift left a little to center over the camera',
  'shift-right': 'Shift right a little to center over the camera',
  'shift-forward': 'Move forward a little (toward the top of the phone)',
  'shift-back': 'Move back a little (toward the bottom of the phone)',
  'look-down': 'Look straight down at the phone',
  'face-phone': "Turn your head so you're facing the phone",
};

/** Angle (degrees) between the camera axis and the face, plus the dominant axis. */
export function offsetAngles(s: PoseSample): { total: number; x: number; y: number } | null {
  if (s.offsetX === undefined || s.offsetY === undefined || !(s.distance > 0)) return null;
  const lateral2 = s.offsetX * s.offsetX + s.offsetY * s.offsetY;
  const depth = Math.sqrt(Math.max(1e-6, s.distance * s.distance - lateral2));
  return {
    total: Math.atan2(Math.sqrt(lateral2), depth) * DEG,
    x: Math.atan2(s.offsetX, depth) * DEG,
    y: Math.atan2(s.offsetY, depth) * DEG,
  };
}

/** Evaluates one sample. Priority of hints: face, distance, centering, head angle. */
export function evaluatePose(s: PoseSample | null, o: GuidanceOptions = DEFAULT_GUIDANCE_OPTIONS): PoseGuidance {
  const tracked = !!s && s.tracked && Number.isFinite(s.distance) && s.distance > 0;
  if (!s || !tracked) {
    return {
      face: 'bad',
      distance: 'unknown',
      centered: 'unknown',
      angle: 'unknown',
      ok: false,
      hint: 'find-face',
      message: HINT_MESSAGES['find-face'],
      distanceM: null,
      offsetDeg: null,
    };
  }

  const distance: CheckState = s.distance < o.minTop || s.distance > o.maxTop ? 'bad' : 'ok';
  const distanceHint: GuidanceHint = s.distance < o.minTop ? 'too-close' : s.distance > o.maxTop ? 'too-far' : null;

  const off = offsetAngles(s);
  let centered: CheckState = 'unknown';
  let centerHint: GuidanceHint = null;
  if (off) {
    centered = off.total <= o.maxOffsetDeg ? 'ok' : 'bad';
    if (centered === 'bad') {
      // Fix the bigger axis first. Face toward the screen's right edge -> shift left, etc.
      if (Math.abs(off.x) >= Math.abs(off.y)) centerHint = off.x > 0 ? 'shift-left' : 'shift-right';
      else centerHint = off.y > 0 ? 'shift-back' : 'shift-forward';
    }
  }

  let angle: CheckState = 'unknown';
  let angleHint: GuidanceHint = null;
  if (s.pitch !== undefined && s.yaw !== undefined) {
    const pitchBad = Math.abs(s.pitch) > o.maxPitchDeg;
    const yawBad = Math.abs(s.yaw) > o.maxYawDeg;
    angle = pitchBad || yawBad ? 'bad' : 'ok';
    // Pitch is the common mistake (looking ahead instead of down).
    angleHint = pitchBad ? 'look-down' : yawBad ? 'face-phone' : null;
  }

  const hint = distanceHint ?? centerHint ?? angleHint;
  return {
    face: 'ok',
    distance,
    centered,
    angle,
    ok: hint === null,
    hint,
    message: hint ? HINT_MESSAGES[hint] : 'Good. Hold still…',
    distanceM: s.distance,
    offsetDeg: off ? off.total : null,
  };
}

export interface StabilityOptions {
  /** How long the user must hold steady (ms). */
  holdMs: number;
  /** Max standard deviation of distance during the hold (meters). */
  maxStdDev: number;
  /** A gap without samples longer than this restarts the hold (ms). */
  maxGapMs: number;
  /** Std dev is only judged once this many samples are in the hold. */
  minSamplesForStd: number;
}

export const DEFAULT_STABILITY_OPTIONS: StabilityOptions = {
  holdMs: 2000,
  maxStdDev: 0.015,
  maxGapMs: 400,
  minSamplesForStd: 5,
};

export type HoldResetReason = 'moved' | 'pose' | 'lost' | 'gap';

export interface HoldUpdate {
  holding: boolean;
  /** 0..1, fills only while steady; drops to 0 on reset. */
  progress: number;
  done: boolean;
  /** Set on the update that restarted / aborted a hold in progress. */
  reset: HoldResetReason | null;
  stdDev: number | null;
}

function std(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length);
}

/** Hold-still tracker: progress only grows while the pose is OK and the distance is steady. */
export class HoldTracker {
  private start: number | null = null;
  private lastT: number | null = null;
  private hold: { t: number; d: number }[] = [];

  constructor(private readonly o: StabilityOptions = DEFAULT_STABILITY_OPTIONS) {}

  /** Distances (meters) collected in the current hold. */
  get samples(): number[] {
    return this.hold.map((s) => s.d);
  }

  reset(): void {
    this.start = null;
    this.lastT = null;
    this.hold = [];
  }

  add(t: number, distance: number, poseOk: boolean, tracked = true): HoldUpdate {
    const wasHolding = this.start !== null;
    if (!poseOk || !tracked) {
      this.reset();
      return { holding: false, progress: 0, done: false, reset: wasHolding ? (tracked ? 'pose' : 'lost') : null, stdDev: null };
    }
    let reset: HoldResetReason | null = null;
    if (wasHolding && this.lastT !== null && t - this.lastT > this.o.maxGapMs) {
      this.reset();
      reset = 'gap';
    }
    if (this.start === null) this.start = t;
    this.lastT = t;
    this.hold.push({ t, d: distance });

    let sd: number | null = null;
    if (this.hold.length >= this.o.minSamplesForStd) {
      sd = std(this.hold.map((s) => s.d));
      if (sd > this.o.maxStdDev) {
        // Moved: restart the hold from this sample.
        this.start = t;
        this.hold = [{ t, d: distance }];
        return { holding: true, progress: 0, done: false, reset: 'moved', stdDev: sd };
      }
    }
    const progress = Math.min(1, (t - this.start) / this.o.holdMs);
    return { holding: true, progress, done: progress >= 1, reset, stdDev: sd };
  }
}

export interface GuideSnapshot {
  pose: PoseGuidance;
  progress: number;
  holding: boolean;
  /** Most recent reason a hold was restarted (cleared when a new hold reaches 25%). */
  lastReset: HoldResetReason | 'rejected' | null;
  /** Message to show (pose hint, or a hold-still prompt). */
  message: string;
  /** Set once calibration locks in. */
  result: Extract<CalibrationResult, { ok: true }> | null;
}

export const RESET_MESSAGES: Record<HoldResetReason | 'rejected', string> = {
  moved: 'You moved. Hold still, starting again',
  pose: 'Lost position. Get back to the top',
  lost: 'Face lost. Keep your face over the phone',
  gap: 'Tracking hiccup. Hold still, starting again',
  rejected: 'Not steady enough. Hold still, starting again',
};

/**
 * Full calibration flow: pose checks gate a 2 s hold-still; when the hold completes, the
 * existing Calibrator (median distance, MAD spread, range) runs on exactly those samples.
 */
export class CalibrationGuide {
  private readonly hold: HoldTracker;
  private lastReset: GuideSnapshot['lastReset'] = null;
  private result: GuideSnapshot['result'] = null;
  private lastPose: PoseGuidance = evaluatePose(null);

  constructor(
    private readonly guidance: GuidanceOptions = DEFAULT_GUIDANCE_OPTIONS,
    stability: StabilityOptions = DEFAULT_STABILITY_OPTIONS,
    private readonly calibration: CalibrationOptions = DEFAULT_CALIBRATION_OPTIONS
  ) {
    this.hold = new HoldTracker(stability);
  }

  get locked(): boolean {
    return this.result !== null;
  }

  add(s: PoseSample): GuideSnapshot {
    if (this.result) return this.snapshot(1, false);
    const pose = evaluatePose(s, this.guidance);
    this.lastPose = pose;
    const tracked = s.tracked && s.distance > 0;
    const u = this.hold.add(s.t, s.distance, pose.ok, tracked);
    if (u.reset) this.lastReset = u.reset;
    else if (u.progress >= 0.25) this.lastReset = null;

    if (u.done) {
      const cal = new Calibrator(this.calibration);
      for (const d of this.hold.samples) cal.add(d, true);
      const r = cal.finish();
      if (r.ok) {
        this.result = r;
        return this.snapshot(1, false);
      }
      this.hold.reset();
      this.lastReset = 'rejected';
      return this.snapshot(0, false);
    }
    return this.snapshot(u.progress, u.holding);
  }

  private snapshot(progress: number, holding: boolean): GuideSnapshot {
    const pose = this.lastPose;
    let message = pose.message;
    if (this.result) message = `Locked: top at ${(this.result.calibration.topDistance * 100).toFixed(0)} cm`;
    else if (pose.ok && this.lastReset && progress < 0.25) message = RESET_MESSAGES[this.lastReset];
    else if (pose.ok) message = 'Good. Hold still…';
    return { pose, progress, holding, lastReset: this.lastReset, message, result: this.result };
  }
}
