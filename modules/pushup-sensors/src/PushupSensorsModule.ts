import { NativeModule, requireNativeModule } from 'expo';

import { PushupSensorsModuleEvents } from './PushupSensors.types';

declare class PushupSensorsModule extends NativeModule<PushupSensorsModuleEvents> {
  /** True on devices with a TrueDepth (Face ID) camera. */
  isFaceTrackingSupported(): boolean;
  /** Enables proximity monitoring. Resolves false if the device has no proximity sensor. */
  startProximity(): Promise<boolean>;
  stopProximity(): Promise<void>;
  /** Starts ARKit face tracking. Resolves false if unsupported or camera permission denied. */
  startFaceDistance(maxHz: number): Promise<boolean>;
  stopFaceDistance(): Promise<void>;
  /** iOS: AVAudioSession .playback so speech is audible with the silent switch on. */
  enablePlaybackAudioSession(): Promise<void>;
}

export default requireNativeModule<PushupSensorsModule>('PushupSensors');
