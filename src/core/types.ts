export type RepQuality = 'full' | 'good' | 'shallow';

/** What triggered the rep: chest touching the phone, or face-depth alone. */
export type RepSource = 'proximity' | 'depth';

export interface Rep {
  /** 1-based rep number within the session. */
  index: number;
  /** ms timestamp at which the rep was completed (chest left the phone / returned to top). */
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
  /** Face tracking dropped out while the chest was on the phone (common: face too close). */
  faceLostAtBottom: boolean;
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
  /** Count a rep from depth alone (no proximity trigger) when it is deep enough. */
  depthOnlyCounting: boolean;
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
  /** Depth-only reps must reach at least this depthRatio to be counted at all. */
  minCountRatio: number;
  /** depthRatio <= this counts as "back at the top" (re-arms depth-only counting). */
  topZoneRatio: number;
  /** Median filter window (samples) applied to face distance. 1 disables smoothing. */
  smoothingWindow: number;
}

export const DEFAULT_CONFIG: DetectorConfig = {
  minRepIntervalMs: 400,
  minNearDurationMs: 80,
  depthOnlyCounting: false,
  proximityImpliesFull: true,
  floorDistance: 0.08,
  fullRatio: 0.7,
  goodRatio: 0.45,
  minCountRatio: 0.3,
  topZoneRatio: 0.2,
  smoothingWindow: 3,
};
