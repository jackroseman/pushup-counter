import { depthRatio, median, qualityForRatio } from './scoring';
import { Calibration, DEFAULT_CONFIG, DetectorConfig, Rep, RepQuality } from './types';

/**
 * Pure rep-detection state machine driven by face distance (ARKit, ~30 Hz). Feed it face and
 * proximity samples with ms timestamps; onFaceDistance returns a Rep whenever one completes.
 *
 * Counting (depth only; needs a calibration of the top position):
 *  - A rep starts when the (median-smoothed) face distance leaves the top zone
 *    (depthRatio > topZoneRatio). The last top-zone sample is the start of the descent.
 *  - It counts when the face comes back to the top zone after going at least minCountRatio
 *    of the way down. A shallower dip is discarded. Reps closer together than
 *    minRepIntervalMs are ignored (debounce).
 *
 * Proximity (optional supporting signal, never required):
 *  - A valid "near" (>= minNearDurationMs) during a rep means the chest touched the phone:
 *    the rep is deep enough to count even if ARKit lost the face at the bottom, and it is
 *    scored Full when proximityImpliesFull. It can never add a second count.
 *
 * Scoring: depthRatio = (top - bottom) / (top - floorDistance) -> Full / Good / Shallow.
 */
export class RepDetector {
  private config: DetectorConfig;
  private calibration: Calibration | null;
  private _reps: Rep[] = [];
  private lastRepAt = -Infinity;

  // proximity
  private near = false;
  private nearSince = 0;

  // smoothing
  private window: number[] = [];
  private lastSmoothed: number | null = null;
  private lastRatio: number | null = null;

  // cycle
  private phase: 'top' | 'down' = 'top';
  private lastTopAt: number | null = null;
  private cycleStartAt: number | null = null;
  private cycleMin = Infinity;
  private cycleMinAt: number | null = null;
  private cycleMax = -Infinity;
  private bottomReached = false;
  private touchedThisCycle = false;
  private touchSpan: [number, number] | null = null;
  private lostAt: number | null = null;
  private lostRatio: number | null = null;
  private lostSpan: [number, number] | null = null;
  private lostSpanRatio: number | null = null;

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

  get isCalibrated(): boolean {
    return this.calibration !== null;
  }

  /** Latest median-smoothed face distance (meters), null before the first tracked sample. */
  get smoothedDistance(): number | null {
    return this.lastSmoothed;
  }

  setCalibration(calibration: Calibration | null): void {
    this.calibration = calibration;
    this.phase = 'top';
    this.resetCycle();
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
    this.lastRatio = null;
    this.phase = 'top';
    this.lastTopAt = null;
    this.resetCycle();
  }

  /** Proximity sensor changed. Never counts a rep by itself; it only supports the depth logic. */
  onProximity(near: boolean, timestamp: number): void {
    if (near === this.near) return; // duplicate event
    this.near = near;
    if (near) {
      this.nearSince = timestamp;
      return;
    }
    if (timestamp - this.nearSince < this.config.minNearDurationMs) return; // glitch
    if (!this.calibration) return;
    if (this.phase === 'top') {
      // Face tracking was lost before we saw the descent; the chest still touched the phone.
      this.phase = 'down';
      this.cycleStartAt = this.lastTopAt ?? this.nearSince;
    }
    this.touchedThisCycle = true;
    this.bottomReached = true;
    this.touchSpan = [this.nearSince, timestamp];
  }

  /**
   * Face distance sample. `distance` in meters; pass tracked=false (or distance null) when ARKit
   * lost the face. Returns the completed rep, if any.
   */
  onFaceDistance(distance: number | null, tracked: boolean, timestamp: number): Rep | null {
    if (!tracked || distance === null || !Number.isFinite(distance) || distance <= 0) {
      // Face lost. Common at the very bottom when the face is too close to the camera.
      this.window = [];
      if (this.phase === 'down' && this.lostAt === null) {
        this.lostAt = timestamp;
        this.lostRatio = this.lastRatio;
      }
      return null;
    }

    if (this.lostAt !== null) {
      if (this.phase === 'down') {
        this.lostSpan = [this.lostAt, timestamp];
        this.lostSpanRatio = this.lostRatio;
      }
      this.lostAt = null;
    }

    this.window.push(distance);
    const w = Math.max(1, Math.floor(this.config.smoothingWindow));
    if (this.window.length > w) this.window.splice(0, this.window.length - w);
    const d = median(this.window);
    this.lastSmoothed = d;
    if (d > this.cycleMax && this.phase === 'top') this.cycleMax = d;

    const cal = this.calibration;
    if (!cal) return null;
    const ratio = depthRatio(cal.topDistance, d, this.config.floorDistance);
    this.lastRatio = ratio;
    const inTopZone = ratio <= this.config.topZoneRatio;

    if (this.phase === 'top') {
      if (inTopZone) {
        this.lastTopAt = timestamp;
        return null;
      }
      this.phase = 'down';
      this.cycleStartAt = this.lastTopAt ?? timestamp;
    }

    // phase === 'down'
    if (d < this.cycleMin) {
      this.cycleMin = d;
      this.cycleMinAt = timestamp;
    }
    if (ratio >= this.config.minCountRatio) this.bottomReached = true;

    // Still on the way, or the proximity sensor still reads "near" (wait for it to clear).
    if (!inTopZone || this.near) return null;

    const counts =
      this.bottomReached && timestamp - this.lastRepAt >= this.config.minRepIntervalMs;
    const rep = counts ? this.completeRep(timestamp) : null;
    // Back at the top either way (a shallow dip or a bounce is simply discarded).
    this.phase = 'top';
    this.lastTopAt = timestamp;
    this.resetCycle();
    this.cycleMax = d;
    return rep;
  }

  private completeRep(timestamp: number): Rep {
    const cal = this.calibration!;
    const cfg = this.config;
    const bottom = Number.isFinite(this.cycleMin) ? this.cycleMin : null;
    const top = Number.isFinite(this.cycleMax) ? this.cycleMax : cal.topDistance;
    const trackedRatio = bottom !== null ? depthRatio(cal.topDistance, bottom, cfg.floorDistance) : null;

    // Face lost at the bottom: tracking dropped mid-rep and either the chest touched the phone or
    // the face was already deep (ARKit loses faces that get too close to the camera).
    const faceLostAtBottom =
      this.lostSpan !== null && (this.touchedThisCycle || (this.lostSpanRatio ?? 0) >= cfg.goodRatio);

    let quality: RepQuality;
    let ratio = trackedRatio;
    if (this.touchedThisCycle && cfg.proximityImpliesFull) {
      quality = 'full';
      ratio = Math.max(trackedRatio ?? 0, cfg.fullRatio);
    } else if (trackedRatio !== null) {
      quality = qualityForRatio(trackedRatio, cfg);
    } else {
      // Only reachable via a proximity touch with proximityImpliesFull disabled and no tracking.
      quality = 'full';
    }

    let bottomAt: number | null = this.cycleMinAt;
    if (faceLostAtBottom && this.lostSpan) bottomAt = (this.lostSpan[0] + this.lostSpan[1]) / 2;
    else if (bottomAt === null && this.touchSpan) bottomAt = (this.touchSpan[0] + this.touchSpan[1]) / 2;
    const startedAt = this.cycleStartAt;
    const prev = this._reps[this._reps.length - 1];

    const rep: Rep = {
      index: this._reps.length + 1,
      timestamp,
      quality,
      source: 'depth',
      bottomDistance: bottom,
      topDistance: top,
      rangeOfMotion: bottom !== null ? Math.max(0, top - bottom) : null,
      depthRatio: ratio,
      faceLostAtBottom,
      startedAt,
      bottomAt,
      descentMs: startedAt !== null && bottomAt !== null ? Math.max(0, bottomAt - startedAt) : null,
      ascentMs: bottomAt !== null ? Math.max(0, timestamp - bottomAt) : null,
      intervalMs: prev ? timestamp - prev.timestamp : null,
      proximityTouched: this.touchedThisCycle,
    };
    this._reps.push(rep);
    this.lastRepAt = timestamp;
    return rep;
  }

  private resetCycle(): void {
    this.cycleStartAt = null;
    this.cycleMin = Infinity;
    this.cycleMinAt = null;
    this.cycleMax = -Infinity;
    this.bottomReached = false;
    this.touchedThisCycle = false;
    this.touchSpan = null;
    this.lostAt = null;
    this.lostRatio = null;
    this.lostSpan = null;
    this.lostSpanRatio = null;
  }
}
