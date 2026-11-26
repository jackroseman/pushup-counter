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
  /**
   * Face offset from the camera axis in meters (only when tracked), in the phone's portrait
   * frame as the user sees the screen: +x toward the right edge, +y toward the top edge.
   */
  offsetX?: number;
  offsetY?: number;
  /** Head angles in degrees relative to the camera (only when tracked); 0 = facing it. */
  pitch?: number;
  yaw?: number;
  roll?: number;
};

export type FaceMeshVariant = 'full' | 'minimal';

export type FaceMeshViewProps = {
  /** Show the pitch / yaw / roll line at the bottom of the view (default true). */
  showAngles?: boolean;
  /**
   * `full` (default): the measurement view. `minimal`: no native labels or marker, white 35 % mesh on
   * black, for the face-centering frame. Builds before 1.3.0 ignore it; check `faceMeshVariantSupported()`.
   */
  variant?: FaceMeshVariant;
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
};

export type FaceTrackingErrorEvent = {
  message: string;
};

export type GravityEvent = {
  /** Core Motion gravity vector in g, device frame (+z out of the screen). Flat, screen up = (0, 0, -1). */
  x: number;
  y: number;
  z: number;
  /** Milliseconds since epoch (same base as Date.now()). */
  timestamp: number;
};

export type PushupSensorsModuleEvents = {
  onProximityChange: (event: ProximityEvent) => void;
  onFaceDistance: (event: FaceDistanceEvent) => void;
  onFaceTrackingError: (event: FaceTrackingErrorEvent) => void;
  onGravity: (event: GravityEvent) => void;
};
