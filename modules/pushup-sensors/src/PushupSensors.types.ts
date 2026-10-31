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

export type FaceMeshViewProps = {
  /** Show the pitch / yaw / roll line at the bottom of the view (default true). */
  showAngles?: boolean;
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
};

export type FaceTrackingErrorEvent = {
  message: string;
};

export type PushupSensorsModuleEvents = {
  onProximityChange: (event: ProximityEvent) => void;
  onFaceDistance: (event: FaceDistanceEvent) => void;
  onFaceTrackingError: (event: FaceTrackingErrorEvent) => void;
};
