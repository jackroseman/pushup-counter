import { registerWebModule, NativeModule } from 'expo';

import { PushupSensorsModuleEvents } from './PushupSensors.types';

// Sensors are not available on the web platform; everything resolves "unsupported".
class PushupSensorsModule extends NativeModule<PushupSensorsModuleEvents> {
  isFaceTrackingSupported(): boolean {
    return false;
  }
  async startProximity(): Promise<boolean> {
    return false;
  }
  async stopProximity(): Promise<void> {}
  async startFaceDistance(_maxHz: number): Promise<boolean> {
    return false;
  }
  async stopFaceDistance(): Promise<void> {}
  async enablePlaybackAudioSession(): Promise<void> {}
  isMotionSupported(): boolean {
    return false;
  }
  async startGravity(_hz: number): Promise<boolean> {
    return false;
  }
  async stopGravity(): Promise<void> {}
  isFaceMeshVariantSupported(): boolean {
    return false;
  }
}

export default registerWebModule(PushupSensorsModule, 'PushupSensorsModule');
