import { depthRatio, median, qualityForRatio } from './scoring';
import { Calibration, DEFAULT_CONFIG, DetectorConfig, Rep, RepQuality, RepSource } from './types';

/**
 * Pure rep-detection state machine. Feed it proximity and face-distance samples
 * (with ms timestamps); it returns a Rep whenever one completes.
 *
 * Counting:
 *  - Proximity path (primary): near -> far = one rep (chest touched the phone, then rose).
 *    Near periods shorter than minNearDurationMs are ignored as glitches, and a rep can't
 *    complete within minRepIntervalMs of the previous one (debounce).
 *  - Depth-only path (optional, config.depthOnlyCounting): when the chest never touched the
 *    phone, a rep is counted once the face went at least minCountRatio of the way down and came
 *    back to the top zone. Needs a calibration.
 *
 * Scoring:
 *  - Proximity reps are Full when proximityImpliesFull (default) - this is also the fallback
 *    when face tracking is unavailable or the face was lost at the bottom.
 *  - Otherwise depthRatio = (top - bottom) / (top - floorDistance) maps to Full/Good/Shallow.
 */
export class RepDetector {
  private config: DetectorConfig;
  private calibration: Calibration | null;
  private _reps: Rep[] = [];

  // proximity state
  private near = false;
  private nearSince = 0;
  private lastRepAt = -Infinity;

  // per-rep (cycle) depth state
  private cycleMin = Infinity;
  private cycleMax = -Infinity;
  private nearSeenThisCycle = false;
  private trackedWhileNear = false;
  private depthArmed = true;
  private depthBottomReached = false;
  private window: number[] = [];
  private lastSmoothed: number | null = null;

  constructor(config: Partial<DetectorConfig> = {}, calibration: Calibration | null = null) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.calibration = calibration;
  }

  get reps(): readonly Rep[] {
    return this._reps;
  }

  get count(): number {
    return this._reps.length;
  }

  get isNear(): boolean {
    return this.near;
  }

  setCalibration(calibration: Calibration | null): void {
    this.calibration = calibration;
    this.depthArmed = true;
  }

  updateConfig(config: Partial<DetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this._reps = [];
    this.near = false;
    this.nearSince = 0;
    this.lastRepAt = -Infinity;
    this.window = [];
    this.lastSmoothed = null;
    this.depthArmed = true;
    this.resetCycle();
  }

  /** Proximity sensor changed. Returns the completed rep on a valid near -> far transition. */
  onProximity(near: boolean, timestamp: number): Rep | null {
    if (near === this.near) return null; // duplicate event
    this.near = near;

    if (near) {
      this.nearSince = timestamp;
      this.nearSeenThisCycle = true;
      this.trackedWhileNear = false;
      return null;
    }

    // near -> far
    const nearDuration = timestamp - this.nearSince;
    if (nearDuration < this.config.minNearDurationMs) {
      // Sensor glitch: forget it ever happened so it can't block a depth-only rep.
      this.nearSeenThisCycle = false;
      return null;
    }
    if (timestamp - this.lastRepAt < this.config.minRepIntervalMs) return null; // debounce
    return this.completeRep('proximity', timestamp);
  }

  /**
   * Face distance sample. `distance` in meters; pass tracked=false (or distance null) when ARKit
   * lost the face. Returns a rep only for depth-only counting.
   */
  onFaceDistance(distance: number | null, tracked: boolean, timestamp: number): Rep | null {
    if (!tracked || distance === null || !Number.isFinite(distance) || distance <= 0) {
      // Face lost. Common at the very bottom when the face is too close to the camera.
      this.window = [];
      return null;
    }

    this.window.push(distance);
    const w = Math.max(1, Math.floor(this.config.smoothingWindow));
    if (this.window.length > w) this.window.splice(0, this.window.length - w);
    const d = median(this.window);
    this.lastSmoothed = d;

    if (this.near) this.trackedWhileNear = true;
    if (d < this.cycleMin) this.cycleMin = d;
    if (d > this.cycleMax) this.cycleMax = d;

    const cal = this.calibration;
    if (!cal) return null;

    const ratio = depthRatio(cal.topDistance, d, this.config.floorDistance);
    if (ratio <= this.config.topZoneRatio) {
      this.depthArmed = true;
      if (
        this.config.depthOnlyCounting &&
        this.depthBottomReached &&
        !this.nearSeenThisCycle &&
        !this.near &&
        timestamp - this.lastRepAt >= this.config.minRepIntervalMs
      ) {
        return this.completeRep('depth', timestamp);
      }
    } else if (this.depthArmed && ratio >= this.config.minCountRatio) {
      this.depthBottomReached = true;
    }
    return null;
  }

  private completeRep(source: RepSource, timestamp: number): Rep {
    const cal = this.calibration;
    const bottom = Number.isFinite(this.cycleMin) ? this.cycleMin : null;
    const top: number | null = Number.isFinite(this.cycleMax) ? this.cycleMax : cal ? cal.topDistance : null;

    // Depth ratio is measured against the calibrated top when we have one (stable reference),
    // otherwise against this rep's own top.
    const reference = cal ? cal.topDistance : top;
    const ratio =
      bottom !== null && reference !== null ? depthRatio(reference, bottom, this.config.floorDistance) : null;

    const faceLostAtBottom = source === 'proximity' && !this.trackedWhileNear;

    let quality: RepQuality;
    if (source === 'proximity' && this.config.proximityImpliesFull) {
      quality = 'full';
    } else if (ratio !== null && !faceLostAtBottom) {
      quality = qualityForRatio(ratio, this.config);
    } else {
      // Proximity triggered but no usable depth (no TrueDepth, or face lost at the bottom):
      // the chest touched the phone, so treat it as full depth.
      quality = 'full';
    }

    const rep: Rep = {
      index: this._reps.length + 1,
      timestamp,
      quality,
      source,
      bottomDistance: bottom,
      topDistance: top,
      rangeOfMotion: bottom !== null && top !== null ? Math.max(0, top - bottom) : null,
      // Face lost at the bottom while the chest was on the phone: treated as full depth.
      depthRatio: faceLostAtBottom && ratio !== null ? Math.max(ratio, this.config.fullRatio) : ratio,
      faceLostAtBottom,
    };
    this._reps.push(rep);
    this.lastRepAt = timestamp;

    this.resetCycle();
    // After a proximity rep the face may still be low; require a return to the top zone before
    // the depth-only path can start a new rep (prevents double counting).
    this.depthArmed = source === 'depth';
    if (this.lastSmoothed !== null) this.cycleMax = this.lastSmoothed;
    return rep;
  }

  private resetCycle(): void {
    this.cycleMin = Infinity;
    this.cycleMax = -Infinity;
    this.nearSeenThisCycle = this.near;
    this.trackedWhileNear = false;
    this.depthBottomReached = false;
  }
}
