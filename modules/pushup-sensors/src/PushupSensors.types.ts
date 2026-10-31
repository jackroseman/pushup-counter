export type ProximityEvent = {
  /** true while something (your chest) covers the proximity sensor. */
  near: boolean;
  /** Milliseconds since epoch (same base as Date.now()). */
  timestamp: number;
};

export type FaceDistanceEvent = {
  /** Face anchor -> TrueDepth camera distance in meters. 0 when not tracked. */
  distance: number;
  tracked: boolean;
  /** Milliseconds since epoch (same base as Date.now()). */
  timestamp: number;
};

export type FaceTrackingErrorEvent = {
  message: string;
};

export type PushupSensorsModuleEvents = {
  onProximityChange: (event: ProximityEvent) => void;
  onFaceDistance: (event: FaceDistanceEvent) => void;
  onFaceTrackingError: (event: FaceTrackingErrorEvent) => void;
};
