import { Platform } from 'react-native';
import PushupSensors from '../modules/pushup-sensors';

export type { ProximityEvent, FaceDistanceEvent, FaceTrackingErrorEvent } from '../modules/pushup-sensors';
export { PushupSensors };

/** Safe wrapper: never throws if the native module is missing (e.g. running in Expo Go by mistake). */
export function faceTrackingSupported(): boolean {
  try {
    return Platform.OS === 'ios' && PushupSensors.isFaceTrackingSupported();
  } catch {
    return false;
  }
}
