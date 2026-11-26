/**
 * PREVIEW BUILD ONLY. Replaces modules/pushup-sensors/src/PushupSensorsModule.web.ts when the web
 * preview is built with tools/preview/metro.config.js (npm --prefix tools/preview run build). Normal web exports,
 * EAS builds and OTA updates never load this file; see docs/ui-preview.md.
 *
 * Emits the same events as the native iOS module from the simulator state in ../simulator/signals.ts.
 * Control it from a script or the browser console through window.previewSim.
 */
import { registerWebModule, NativeModule } from 'expo';

import type { PushupSensorsModuleEvents } from '../../../modules/pushup-sensors/src/PushupSensors.types';
import {
  DEFAULT_SIM_STATE,
  FACE_INTERVAL_MS,
  SimPhone,
  SimState,
  completedReps,
  endOfCurrentRep,
  faceDistanceAt,
  gravityFor,
  gravityIntervalMs,
} from '../simulator/signals';

/** Marker the build script looks for, to prove the simulator made it into the preview bundle. */
export const PREVIEW_MARKER = 'RR_PREVIEW_SENSOR_SIMULATOR';

const state: SimState = { ...DEFAULT_SIM_STATE };

export interface PreviewSim {
  marker: string;
  state(): SimState;
  set(patch: Partial<SimState>): SimState;
  flat(): void;
  lean(): void;
  tilt(): void;
  stall(on?: boolean): void;
  loseFace(): void;
  findFace(): void;
  /** Start push-ups: `count` of them then hold at the top, or keep going until stopReps() if omitted. */
  startReps(periodMs?: number, count?: number): void;
  /** Finish the push-up in progress, then hold at the top. */
  stopReps(): void;
  /** Reps the waveform has completed since startReps (what the app should be showing). */
  expectedReps(): number;
}

const previewSim: PreviewSim = {
  marker: PREVIEW_MARKER,
  state: () => ({ ...state }),
  set: (patch) => Object.assign(state, patch),
  flat: () => setPhone('flat'),
  lean: () => setPhone('lean'),
  tilt: () => setPhone('tilt'),
  stall: (on = true) => {
    state.stalled = on;
  },
  loseFace: () => {
    state.faceTracked = false;
  },
  findFace: () => {
    state.faceTracked = true;
  },
  startReps: (periodMs, count) => {
    if (periodMs) state.periodMs = periodMs;
    state.repsStartedAt = performance.now();
    state.repsEndAt = count ? state.repsStartedAt + count * state.periodMs : null;
  },
  stopReps: () => {
    state.repsEndAt = endOfCurrentRep(state, performance.now());
  },
  expectedReps: () => completedReps(state, performance.now()),
};

function setPhone(phone: SimPhone) {
  state.phone = phone;
}

(globalThis as unknown as { previewSim: PreviewSim }).previewSim = previewSim;

class PushupSensorsModule extends NativeModule<PushupSensorsModuleEvents> {
  private faceTimer: ReturnType<typeof setInterval> | null = null;
  private gravTimer: ReturnType<typeof setTimeout> | null = null;

  isFaceTrackingSupported(): boolean {
    return true;
  }
  async startProximity(): Promise<boolean> {
    return false;
  }
  async stopProximity(): Promise<void> {}
  async startFaceDistance(_maxHz: number): Promise<boolean> {
    if (this.faceTimer) clearInterval(this.faceTimer);
    this.faceTimer = setInterval(() => {
      const timestamp = Date.now();
      if (!state.faceTracked) {
        this.emit('onFaceDistance', { distance: 0, tracked: false, timestamp });
        return;
      }
      const distance = faceDistanceAt(state, performance.now(), (Math.random() - 0.5) * 0.004);
      this.emit('onFaceDistance', { distance, tracked: true, timestamp, offsetX: 0, offsetY: 0, pitch: 2, yaw: 1, roll: 0 });
    }, FACE_INTERVAL_MS);
    return true;
  }
  async stopFaceDistance(): Promise<void> {
    if (this.faceTimer) clearInterval(this.faceTimer);
    this.faceTimer = null;
  }
  async enablePlaybackAudioSession(): Promise<void> {}
  isMotionSupported(): boolean {
    return true;
  }
  async startGravity(_hz: number): Promise<boolean> {
    if (this.gravTimer) clearTimeout(this.gravTimer);
    const tick = () => {
      this.emit('onGravity', { ...gravityFor(state.phone), timestamp: Date.now() });
      this.gravTimer = setTimeout(tick, gravityIntervalMs(state));
    };
    this.gravTimer = setTimeout(tick, gravityIntervalMs(state));
    return true;
  }
  async stopGravity(): Promise<void> {
    if (this.gravTimer) clearTimeout(this.gravTimer);
    this.gravTimer = null;
  }
  isFaceMeshVariantSupported(): boolean {
    return false;
  }
}

export default registerWebModule(PushupSensorsModule, 'PushupSensorsModule');
