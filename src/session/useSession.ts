import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Calibrator, Rep, RepDetector, qualityLabel, summarize } from '../core';
import { HistoryStore, SessionRecord } from '../storage/history';
import { Settings } from '../storage/settings';
import { PushupSensors, faceTrackingSupported } from '../sensors';

const KEEP_AWAKE_TAG = 'pushup-session';
const COUNTDOWN_SECONDS = 3;
const CALIBRATION_MS = 2000;
const FACE_HZ = 30;

export type SessionPhase = 'starting' | 'calibrating' | 'active' | 'finished';

export interface SessionState {
  phase: SessionPhase;
  count: number;
  lastRep: Rep | null;
  /** Message shown under the counter (countdown, calibration result, warnings). */
  status: string;
  faceTracking: boolean;
  calibratedTop: number | null;
  faceVisible: boolean;
  proximityAvailable: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function say(text: string) {
  Speech.speak(text, { rate: 1.05, useApplicationAudioSession: true });
}

export const historyStore = new HistoryStore(AsyncStorage);

export function useSession(settings: Settings) {
  const detector = useRef(new RepDetector({ depthOnlyCounting: settings.depthOnlyCounting }));
  const calibrator = useRef<Calibrator | null>(null);
  const startedAt = useRef(Date.now());
  const calibratedTop = useRef<number | null>(null);
  const faceTrackingRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cancelled = useRef(false);
  /** Reps are only counted once calibration is done and the session is live. */
  const active = useRef(false);

  const [state, setState] = useState<SessionState>({
    phase: 'starting',
    count: 0,
    lastRep: null,
    status: 'Getting ready…',
    faceTracking: false,
    calibratedTop: null,
    faceVisible: false,
    proximityAvailable: true,
  });
  const patch = useCallback((p: Partial<SessionState>) => setState((s) => ({ ...s, ...p })), []);

  const onRep = useCallback(
    (rep: Rep) => {
      const s = settingsRef.current;
      const label = qualityLabel(rep.quality);
      say(s.speakQuality && rep.quality !== 'full' ? `${rep.index}, ${label.toLowerCase()}` : String(rep.index));
      if (s.haptics) {
        Haptics.impactAsync(rep.quality === 'full' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(
          () => {}
        );
      }
      patch({ count: rep.index, lastRep: rep });
    },
    [patch]
  );

  useEffect(() => {
    cancelled.current = false;
    const subs = [
      PushupSensors.addListener('onProximityChange', (e) => {
        if (!active.current) return;
        const rep = detector.current.onProximity(e.near, e.timestamp);
        if (rep) onRep(rep);
      }),
      PushupSensors.addListener('onFaceDistance', (e) => {
        if (calibrator.current) {
          calibrator.current.add(e.distance, e.tracked);
          return;
        }
        if (!active.current) return;
        const rep = detector.current.onFaceDistance(e.tracked ? e.distance : null, e.tracked, e.timestamp);
        if (rep) onRep(rep);
        setState((s) => (s.faceVisible === e.tracked ? s : { ...s, faceVisible: e.tracked }));
      }),
      PushupSensors.addListener('onFaceTrackingError', (e) => {
        patch({ status: `Depth tracking error: ${e.message}. Counting with proximity only.` });
      }),
    ];

    (async () => {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      await PushupSensors.enablePlaybackAudioSession().catch(() => {});
      const proximityOk = await PushupSensors.startProximity().catch(() => false);

      let faceOk = false;
      if (faceTrackingSupported()) {
        faceOk = await PushupSensors.startFaceDistance(FACE_HZ).catch(() => false);
      }
      faceTrackingRef.current = faceOk;
      if (cancelled.current) return;
      patch({ proximityAvailable: proximityOk, faceTracking: faceOk });

      if (faceOk) {
        // Calibration: user holds the top (arms extended) position over the phone.
        patch({ phase: 'calibrating', status: 'Get into the top position, face over the phone' });
        say('Get into the top position');
        for (let i = COUNTDOWN_SECONDS; i > 0; i--) {
          if (cancelled.current) return;
          patch({ status: `Hold the top position… ${i}` });
          await sleep(1000);
        }
        patch({ status: 'Calibrating… hold still' });
        calibrator.current = new Calibrator();
        await sleep(CALIBRATION_MS);
        const result = calibrator.current.finish();
        calibrator.current = null;
        if (cancelled.current) return;
        if (result.ok) {
          calibratedTop.current = result.calibration.topDistance;
          detector.current.setCalibration(result.calibration);
          patch({
            calibratedTop: result.calibration.topDistance,
            status: `Calibrated: top at ${(result.calibration.topDistance * 100).toFixed(0)} cm`,
          });
        } else {
          patch({
            status:
              result.reason === 'not-enough-samples'
                ? "Couldn't see your face. Depth scoring off; counting with proximity."
                : 'Calibration was unsteady. Depth scoring off; counting with proximity.',
          });
        }
      } else {
        patch({
          status: proximityOk
            ? 'Depth camera unavailable. Counting with proximity; every rep counts as full depth.'
            : 'No proximity sensor found on this device.',
        });
      }

      if (cancelled.current) return;
      startedAt.current = Date.now();
      active.current = true;
      patch({ phase: 'active' });
      say('Go');
    })();

    return () => {
      cancelled.current = true;
      active.current = false;
      subs.forEach((s) => s.remove());
      PushupSensors.stopProximity().catch(() => {});
      PushupSensors.stopFaceDistance().catch(() => {});
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [onRep, patch]);

  useEffect(() => {
    detector.current.updateConfig({ depthOnlyCounting: settings.depthOnlyCounting });
  }, [settings.depthOnlyCounting]);

  /** Ends the session, persists it (if it has reps) and returns the record. */
  const finish = useCallback(async (): Promise<SessionRecord> => {
    cancelled.current = true;
    active.current = false;
    await PushupSensors.stopProximity().catch(() => {});
    await PushupSensors.stopFaceDistance().catch(() => {});
    const endedAt = Date.now();
    const reps = [...detector.current.reps];
    const record: SessionRecord = {
      id: `${startedAt.current}`,
      startedAt: startedAt.current,
      endedAt,
      reps,
      summary: summarize(reps, startedAt.current, endedAt),
      calibratedTopDistance: calibratedTop.current,
      depthTracking: faceTrackingRef.current,
    };
    patch({ phase: 'finished' });
    say(`Done. ${reps.length} ${reps.length === 1 ? 'pushup' : 'pushups'}`);
    await historyStore.add(record).catch(() => {});
    return record;
  }, [patch]);

  return { state, finish };
}
