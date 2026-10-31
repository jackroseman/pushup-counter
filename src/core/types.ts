export type RepQuality = 'full' | 'good' | 'shallow';

/**
 * What counted the rep. New sets always count from face depth ('depth'); 'proximity' only
 * appears in sets saved by older versions of the app, which counted chest-to-phone touches.
 */
export type RepSource = 'proximity' | 'depth';

export interface Rep {
  /** 1-based rep number within the session. */
  index: number;
  /** ms timestamp at which the rep was completed (face back in the top zone). */
  timestamp: number;
  quality: RepQuality;
  source: RepSource;
  /** Smallest face->camera distance seen during the rep (meters), null if never tracked. */
  bottomDistance: number | null;
  /** Largest face->camera distance seen before the descent (meters), null if unknown. */
  topDistance: number | null;
  /** topDistance - bottomDistance in meters, null if unknown. */
  rangeOfMotion: number | null;
  /** 0..1 fraction of the available depth that was used, null if unknown. */
  depthRatio: number | null;
  /** Face tracking dropped out at the bottom of the rep (common: face too close to the camera). */
  faceLostAtBottom: boolean;

  // ---- Timing (added in v2; absent on sets saved by older versions) ----
  /** ms timestamp when the descent started (last moment in the top zone). */
  startedAt?: number | null;
  /** ms timestamp of the bottom of the rep. */
  bottomAt?: number | null;
  /** startedAt -> bottomAt, ms. */
  descentMs?: number | null;
  /** bottomAt -> timestamp, ms. */
  ascentMs?: number | null;
  /** Time since the previous rep was completed, ms (null for the first rep). */
  intervalMs?: number | null;
  /** The proximity sensor fired during this rep (chest touched the phone). */
  proximityTouched?: boolean;
}

export interface Calibration {
  /** Face->camera distance with arms extended (top of the pushup), meters. */
  topDistance: number;
}

export interface DetectorConfig {
  /** A rep can't complete sooner than this after the previous rep (debounce), ms. */
  minRepIntervalMs: number;
  /** Proximity "near" periods shorter than this are treated as sensor glitches, ms. */
  minNearDurationMs: number;
  /** When the chest touched the phone (proximity near), the rep is Full regardless of depth data. */
  proximityImpliesFull: boolean;
  /**
   * Closest the face anchor can physically get to the camera (meters). The ARKit face anchor
   * sits roughly at the centre of the head, so even nose-on-phone reads ~6-10 cm.
   */
  floorDistance: number;
  /** depthRatio >= this is Full. */
  fullRatio: number;
  /** depthRatio >= this is Good (otherwise Shallow). */
  goodRatio: number;
  /** Reps must reach at least this depthRatio to be counted at all. */
  minCountRatio: number;
  /** depthRatio <= this counts as "at the top" (a rep starts when you leave it and ends when you return). */
  topZoneRatio: number;
  /** Median filter window (samples) applied to face distance. 1 disables smoothing. */
  smoothingWindow: number;
}

export const DEFAULT_CONFIG: DetectorConfig = {
  minRepIntervalMs: 400,
  minNearDurationMs: 80,
  proximityImpliesFull: true,
  floorDistance: 0.08,
  fullRatio: 0.7,
  goodRatio: 0.45,
  minCountRatio: 0.3,
  topZoneRatio: 0.2,
  smoothingWindow: 3,
};

/** Face distance threshold (meters) for a given depth ratio, relative to a calibrated top. */
export function distanceForRatio(top: number, ratio: number, floorDistance: number = DEFAULT_CONFIG.floorDistance): number {
  return top - ratio * (top - floorDistance);
}
