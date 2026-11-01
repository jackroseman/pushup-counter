import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CalibrationGuide,
  Calibration,
  GuideSnapshot,
  GuidanceHint,
  HINT_MESSAGES,
  Rep,
  RepDetector,
  RepQuality,
  TraceRecorder,
  qualityLabel,
  summarize,
} from '../core';
import { HistoryStore, SessionRecord } from '../storage/history';
import { Settings } from '../storage/settings';
import { PushupSensors, faceTrackingSupported } from '../sensors';
import { notifyHistoryChanged } from '../backend/syncEvents';

const KEEP_AWAKE_TAG = 'pushup-session';
/** Countdown after calibration locks in (the user can redo it during this time). */
const COUNTDOWN_SECONDS = 3;
/** Guidance UI refresh rate (the guide itself sees every sample). */
const GUIDE_UI_MS = 100;
/** Spoken hints: only once a hint has persisted this long, and not more often than SPEAK_GAP_MS. */
const HINT_SPEAK_AFTER_MS = 1500;
const SPEAK_GAP_MS = 4000;
const FACE_HZ = 30;
/** How much history the live chart keeps. */
export const LIVE_WINDOW_MS = 12_000;
const FACE_LOST_WARNING_MS = 2500;

export type SessionPhase = 'starting' | 'calibrating' | 'locked' | 'active' | 'finished' | 'unavailable';

export interface SessionState {
  phase: SessionPhase;
  count: number;
  lastRep: Rep | null;
  /** Message shown under the counter (countdown, calibration result, warnings). */
  status: string;
  calibratedTop: number | null;
  faceVisible: boolean;
  proximityAvailable: boolean;
  /** Live calibration guidance (checks, hold progress); null outside calibration. */
  guide: GuideSnapshot | null;
  /** Seconds left before counting starts after calibration locked (phase 'locked'). */
  countdown: number | null;
}

/** Mutable buffer read by the live chart at its own frame rate (no React re-render per sample). */
export interface LiveData {
  /** Smoothed face distance samples (meters, null = face not tracked) within LIVE_WINDOW_MS. */
  samples: { t: number; d: number | null }[];
  reps: { t: number; quality: RepQuality; index: number }[];
  top: number | null;
}


function say(text: string) {
  Speech.speak(text, { rate: 1.05, useApplicationAudioSession: true });
}

export const historyStore = new HistoryStore(AsyncStorage);

export function useSession(settings: Settings) {
  const detector = useRef(new RepDetector());
  const guide = useRef<CalibrationGuide | null>(null);
  const lastGuidePush = useRef(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hintState = useRef<{ hint: GuidanceHint; since: number; spokenHint: GuidanceHint; lastSpoke: number }>({
    hint: null,
    since: 0,
    spokenHint: null,
    lastSpoke: 0,
  });
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
    guide: null,
    countdown: null,
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

  const clearCountdown = () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
  };

  const goActive = useCallback(() => {
    clearCountdown();
    if (cancelled.current) return;
    startedAt.current = Date.now();
    trace.current = new TraceRecorder(startedAt.current);
    active.current = true;
    patch({ phase: 'active', countdown: null, guide: null, status: 'Go!' });
    say('Go');
  }, [patch]);

  const onLocked = useCallback(
    (calibration: Calibration, snap: GuideSnapshot) => {
      guide.current = null;
      calibratedTop.current = calibration.topDistance;
      detector.current.setCalibration(calibration);
      live.current.top = calibration.topDistance;
      const cm = Math.round(calibration.topDistance * 100);
      patch({
        phase: 'locked',
        calibratedTop: calibration.topDistance,
        guide: snap,
        countdown: COUNTDOWN_SECONDS,
        status: `Top locked at ${cm} cm`,
      });
      say(`Locked at ${cm} centimeters`);
      let left = COUNTDOWN_SECONDS;
      clearCountdown();
      countdownTimer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) goActive();
        else patch({ countdown: left });
      }, 1000);
    },
    [goActive, patch]
  );

  /** (Re)starts guided calibration: pose checks gate a 2 s hold-still, then the median locks in. */
  const startCalibration = useCallback(() => {
    clearCountdown();
    active.current = false;
    detector.current = new RepDetector();
    trace.current = null;
    calibratedTop.current = null;
    live.current.top = null;
    live.current.reps = [];
    hintState.current = { hint: null, since: 0, spokenHint: null, lastSpoke: 0 };
    guide.current = new CalibrationGuide();
    patch({
      phase: 'calibrating',
      count: 0,
      lastRep: null,
      calibratedTop: null,
      countdown: null,
      guide: guide.current.add({ t: Date.now(), tracked: false, distance: 0 }),
      status: 'Get into the top position, face over the phone',
    });
    say('Get into the top position, face over the phone');
  }, [patch]);

  /** Redo calibration: allowed while locked, or once counting started but before any rep. */
  const recalibrate = useCallback(() => {
    if (cancelled.current) return;
    if (detector.current.reps.length > 0) return;
    startCalibration();
  }, [startCalibration]);

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
        const g = guide.current;
        if (g && !cancelled.current) {
          const snap = g.add({
            t: e.timestamp,
            tracked: e.tracked,
            distance: e.distance,
            offsetX: e.offsetX,
            offsetY: e.offsetY,
            pitch: e.pitch,
            yaw: e.yaw,
            roll: e.roll,
          });
          if (snap.result) {
            onLocked(snap.result.calibration, snap);
          } else {
            if (e.timestamp - lastGuidePush.current >= GUIDE_UI_MS) {
              lastGuidePush.current = e.timestamp;
              setState((s) => (s.phase === 'calibrating' ? { ...s, guide: snap } : s));
            }
            // Spoken coaching for a hint that persists (the user may not be able to read the screen).
            const h = hintState.current;
            const hint = snap.pose.hint;
            if (hint !== h.hint) {
              h.hint = hint;
              h.since = e.timestamp;
            } else if (
              hint &&
              hint !== h.spokenHint &&
              e.timestamp - h.since > HINT_SPEAK_AFTER_MS &&
              e.timestamp - h.lastSpoke > SPEAK_GAP_MS
            ) {
              h.spokenHint = hint;
              h.lastSpoke = e.timestamp;
              say(HINT_MESSAGES[hint].split(':')[0]);
            }
            if (!hint && h.spokenHint) h.spokenHint = null;
          }
        }

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

      // Guided calibration (see CalibrationGuide); locking in starts a short countdown, then counting.
      startCalibration();
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
      guide.current = null;
      clearCountdown();
      clearInterval(warn);
      subs.forEach((s) => s.remove());
      PushupSensors.stopProximity().catch(() => {});
      PushupSensors.stopFaceDistance().catch(() => {});
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [onRep, onLocked, startCalibration, patch]);

  /** Ends the session, persists it (if it has reps) and returns the record. */
  const finish = useCallback(async (): Promise<SessionRecord> => {
    cancelled.current = true;
    active.current = false;
    guide.current = null;
    clearCountdown();
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
    notifyHistoryChanged();
    return record;
  }, [patch]);

  return { state, finish, live, recalibrate };
}
