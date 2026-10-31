import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Calibrator, Rep, RepDetector, RepQuality, TraceRecorder, qualityLabel, summarize } from '../core';
import { HistoryStore, SessionRecord } from '../storage/history';
import { Settings } from '../storage/settings';
import { PushupSensors, faceTrackingSupported } from '../sensors';

const KEEP_AWAKE_TAG = 'pushup-session';
const COUNTDOWN_SECONDS = 3;
const CALIBRATION_MS = 2000;
const FACE_HZ = 30;
/** How much history the live chart keeps. */
export const LIVE_WINDOW_MS = 12_000;
const FACE_LOST_WARNING_MS = 2500;

export type SessionPhase = 'starting' | 'calibrating' | 'active' | 'finished' | 'unavailable';

export interface SessionState {
  phase: SessionPhase;
  count: number;
  lastRep: Rep | null;
  /** Message shown under the counter (countdown, calibration result, warnings). */
  status: string;
  calibratedTop: number | null;
  faceVisible: boolean;
  proximityAvailable: boolean;
}

/** Mutable buffer read by the live chart at its own frame rate (no React re-render per sample). */
export interface LiveData {
  /** Smoothed face distance samples (meters, null = face not tracked) within LIVE_WINDOW_MS. */
  samples: { t: number; d: number | null }[];
  reps: { t: number; quality: RepQuality; index: number }[];
  top: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function say(text: string) {
  Speech.speak(text, { rate: 1.05, useApplicationAudioSession: true });
}

export const historyStore = new HistoryStore(AsyncStorage);

export function useSession(settings: Settings) {
  const detector = useRef(new RepDetector());
  const calibrator = useRef<Calibrator | null>(null);
  const trace = useRef<TraceRecorder | null>(null);
  const startedAt = useRef(Date.now());
  const calibratedTop = useRef<number | null>(null);
  const lastTrackedAt = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cancelled = useRef(false);
  /** Reps are only counted once calibration is done and the session is live. */
  const active = useRef(false);
  const live = useRef<LiveData>({ samples: [], reps: [], top: null });

  const [state, setState] = useState<SessionState>({
    phase: 'starting',
    count: 0,
    lastRep: null,
    status: 'Getting ready…',
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
      live.current.reps.push({ t: rep.timestamp, quality: rep.quality, index: rep.index });
      patch({ count: rep.index, lastRep: rep });
    },
    [patch]
  );

  useEffect(() => {
    cancelled.current = false;
    const subs = [
      PushupSensors.addListener('onProximityChange', (e) => {
        if (!active.current) return;
        detector.current.onProximity(e.near, e.timestamp);
      }),
      PushupSensors.addListener('onFaceDistance', (e) => {
        const d = e.tracked && e.distance > 0 ? e.distance : null;
        if (d !== null) lastTrackedAt.current = e.timestamp;
        if (calibrator.current) calibrator.current.add(e.distance, e.tracked);

        let rep: Rep | null = null;
        if (active.current) {
          rep = detector.current.onFaceDistance(d, d !== null, e.timestamp);
          trace.current?.add(d, e.timestamp);
        }
        // Live chart buffer (raw while calibrating, smoothed once the detector runs).
        const shown = d === null ? null : active.current ? detector.current.smoothedDistance ?? d : d;
        const buf = live.current;
        buf.samples.push({ t: e.timestamp, d: shown });
        const cutoff = e.timestamp - LIVE_WINDOW_MS - 1000;
        let drop = 0;
        while (drop < buf.samples.length && buf.samples[drop].t < cutoff) drop++;
        if (drop) buf.samples.splice(0, drop);
        while (buf.reps.length && buf.reps[0].t < cutoff) buf.reps.shift();

        if (rep) onRep(rep);
        setState((s) => (s.faceVisible === (d !== null) ? s : { ...s, faceVisible: d !== null }));
      }),
      PushupSensors.addListener('onFaceTrackingError', (e) => {
        patch({ status: `Depth tracking problem: ${e.message}` });
      }),
    ];

    (async () => {
      if (!faceTrackingSupported()) {
        patch({
          phase: 'unavailable',
          status:
            "This iPhone has no TrueDepth (Face ID) camera, so it can't measure pushup depth. Reps are counted from depth, so counting isn't possible on this device.",
        });
        return;
      }
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      await PushupSensors.enablePlaybackAudioSession().catch(() => {});
      const faceOk = await PushupSensors.startFaceDistance(FACE_HZ).catch(() => false);
      if (cancelled.current) return;
      if (!faceOk) {
        patch({
          phase: 'unavailable',
          status:
            'Face tracking could not start. Allow camera access in Settings › Pushup Counter › Camera, then try again.',
        });
        return;
      }
      // Optional helper signal: lets reps where your chest touched the phone count as Full.
      const proximityOk = await PushupSensors.startProximity().catch(() => false);
      if (cancelled.current) return;
      patch({ proximityAvailable: proximityOk });

      // Calibration: user holds the top (arms extended) position over the phone. Retries until it works.
      patch({ phase: 'calibrating', status: 'Get into the top position, face over the phone' });
      say('Get into the top position');
      for (let attempt = 0; ; attempt++) {
        for (let i = COUNTDOWN_SECONDS; i > 0; i--) {
          if (cancelled.current) return;
          patch({ status: `${attempt ? 'Try again: hold' : 'Hold'} the top position… ${i}` });
          await sleep(1000);
        }
        if (cancelled.current) return;
        patch({ status: 'Calibrating… hold still' });
        calibrator.current = new Calibrator();
        await sleep(CALIBRATION_MS);
        const result = calibrator.current.finish();
        calibrator.current = null;
        if (cancelled.current) return;
        if (result.ok) {
          calibratedTop.current = result.calibration.topDistance;
          detector.current.setCalibration(result.calibration);
          live.current.top = result.calibration.topDistance;
          patch({
            calibratedTop: result.calibration.topDistance,
            status: `Calibrated: top at ${(result.calibration.topDistance * 100).toFixed(0)} cm`,
          });
          break;
        }
        const why =
          result.reason === 'not-enough-samples'
            ? "Couldn't see your face. Keep your face over the phone."
            : result.reason === 'out-of-range'
              ? 'Your face was too close or too far. Arms straight, phone under your chest.'
              : 'You moved during calibration. Hold still at the top.';
        patch({ status: why });
        say('Hold still at the top');
        await sleep(1500);
      }

      if (cancelled.current) return;
      startedAt.current = Date.now();
      trace.current = new TraceRecorder(startedAt.current);
      active.current = true;
      patch({ phase: 'active' });
      say('Go');
    })();

    // Warn when the face has been out of view for a while during the set.
    const warn = setInterval(() => {
      if (!active.current) return;
      const lost = Date.now() - lastTrackedAt.current > FACE_LOST_WARNING_MS;
      setState((s) => {
        const msg = "Can't see your face. Keep it over the phone.";
        if (lost && s.status !== msg) return { ...s, status: msg };
        if (!lost && s.status === msg) return { ...s, status: 'Tracking your face ✓' };
        return s;
      });
    }, 500);

    return () => {
      cancelled.current = true;
      active.current = false;
      clearInterval(warn);
      subs.forEach((s) => s.remove());
      PushupSensors.stopProximity().catch(() => {});
      PushupSensors.stopFaceDistance().catch(() => {});
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [onRep, patch]);

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
      depthTracking: true,
      version: 2,
      trace: trace.current?.finish() ?? [],
    };
    patch({ phase: 'finished' });
    say(`Done. ${reps.length} ${reps.length === 1 ? 'pushup' : 'pushups'}`);
    await historyStore.add(record).catch(() => {});
    return record;
  }, [patch]);

  return { state, finish, live };
}
