import { Platform } from 'react-native';
import PushupSensors from '../modules/pushup-sensors';

export type { ProximityEvent, FaceDistanceEvent, FaceTrackingErrorEvent, GravityEvent } from '../modules/pushup-sensors';
export { PushupSensors };

/** Safe wrapper: never throws if the native module is missing (e.g. running in Expo Go by mistake). */
export function faceTrackingSupported(): boolean {
  try {
    return Platform.OS === 'ios' && PushupSensors.isFaceTrackingSupported();
  } catch {
    return false;
  }
}

/** Core Motion is available in this native build (1.2.1+) and on this device. Never throws. */
export function motionSupported(): boolean {
  try {
    return Platform.OS === 'ios' && typeof PushupSensors.isMotionSupported === 'function' && PushupSensors.isMotionSupported() === true;
  } catch {
    return false;
  }
}

/** This native build's FaceMeshView supports `variant="minimal"` (1.3.0+) and the device has a TrueDepth camera. Never throws. */
export function faceMeshVariantSupported(): boolean {
  try {
    return (
      Platform.OS === 'ios' &&
      typeof PushupSensors.isFaceMeshVariantSupported === 'function' &&
      PushupSensors.isFaceMeshVariantSupported() === true &&
      PushupSensors.isFaceTrackingSupported() === true
    );
  } catch {
    return false;
  }
}

/** Starts gravity updates. Resolves false (never rejects) when the build or device can't. */
export async function startGravity(hz: number): Promise<boolean> {
  if (!motionSupported() || typeof PushupSensors.startGravity !== 'function') return false;
  try {
    return (await PushupSensors.startGravity(hz)) === true;
  } catch {
    return false;
  }
}

export async function stopGravity(): Promise<void> {
  try {
    if (typeof PushupSensors.stopGravity === 'function') await PushupSensors.stopGravity();
  } catch {
    // ignore
  }
}
