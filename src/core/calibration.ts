import { median } from './scoring';
import { Calibration } from './types';

export interface CalibrationOptions {
  /** Minimum tracked samples needed (at ~30 Hz, 2 s gives ~60). */
  minSamples: number;
  /** Plausible top distance range in meters. */
  minDistance: number;
  maxDistance: number;
  /** Max median absolute deviation (meters); more means the user was moving. */
  maxSpread: number;
}

export const DEFAULT_CALIBRATION_OPTIONS: CalibrationOptions = {
  minSamples: 15,
  minDistance: 0.15,
  maxDistance: 1.2,
  maxSpread: 0.05,
};

export type CalibrationResult =
  | { ok: true; calibration: Calibration; samples: number }
  | { ok: false; reason: 'not-enough-samples' | 'out-of-range' | 'too-much-movement'; samples: number };

/** Collects tracked face distances while the user holds the top (arms extended) position. */
export class Calibrator {
  private samples: number[] = [];

  constructor(private readonly options: CalibrationOptions = DEFAULT_CALIBRATION_OPTIONS) {}

  add(distance: number, tracked: boolean): void {
    if (tracked && Number.isFinite(distance) && distance > 0) this.samples.push(distance);
  }

  get count(): number {
    return this.samples.length;
  }

  finish(): CalibrationResult {
    const n = this.samples.length;
    if (n < this.options.minSamples) return { ok: false, reason: 'not-enough-samples', samples: n };
    const top = median(this.samples);
    if (top < this.options.minDistance || top > this.options.maxDistance) {
      return { ok: false, reason: 'out-of-range', samples: n };
    }
    const mad = median(this.samples.map((d) => Math.abs(d - top)));
    if (mad > this.options.maxSpread) return { ok: false, reason: 'too-much-movement', samples: n };
    return { ok: true, calibration: { topDistance: top }, samples: n };
  }
}
