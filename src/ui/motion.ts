import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

import { motion } from './tokens';

/**
 * Shared motion rules (plan PR 14). Every animation reads its duration, easing and whether it
 * may move from `motionSpec`, so Reduce Motion is handled in one place: moves (scale, slide,
 * sweep) become plain opacity crossfades.
 */

export type MotionKind = 'press' | 'ring' | 'roll' | 'lock' | 'sweep' | 'fade';

export interface MotionSpec {
  duration: number;
  easing: (t: number) => number;
  /** False under Reduce Motion: no scale, slide or sweep, only an opacity change. */
  move: boolean;
}

const NORMAL: Record<MotionKind, Omit<MotionSpec, 'move'>> = {
  press: { duration: motion.press, easing: motion.easing },
  ring: { duration: motion.ring, easing: motion.easing },
  roll: { duration: motion.roll, easing: motion.easing },
  lock: { duration: motion.lock, easing: motion.easing },
  sweep: { duration: motion.sweep, easing: Easing.linear },
  fade: { duration: motion.fade, easing: motion.easing },
};

/** Reduce Motion: the ring and the 3-2-1 ring jump (duration 0); everything else crossfades. */
const REDUCED: Record<MotionKind, number> = {
  press: motion.press,
  ring: 0,
  roll: motion.crossfade,
  lock: motion.crossfade,
  sweep: 0,
  fade: motion.crossfade,
};

export function motionSpec(kind: MotionKind, reduced: boolean): MotionSpec {
  if (!reduced) return { ...NORMAL[kind], move: true };
  return { duration: REDUCED[kind], easing: NORMAL[kind].easing, move: false };
}

// ---- Reduce Motion (system setting) ----------------------------------------------------------

type Info = Pick<typeof AccessibilityInfo, 'isReduceMotionEnabled' | 'addEventListener'>;

/** Holds the current Reduce Motion value and tells listeners when it changes. */
export function createReduceMotionStore(info: Info = AccessibilityInfo) {
  let value = false;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    listeners.forEach((l) => l());
  };
  return {
    /** Read the system setting once and listen for changes. Safe to call again. */
    start() {
      if (started) return;
      started = true;
      Promise.resolve(info.isReduceMotionEnabled())
        .then((v) => set(!!v))
        .catch(() => {});
      info.addEventListener('reduceMotionChanged', (v: boolean) => set(!!v));
    },
    get: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const store = createReduceMotionStore();
// Read at import so the value is known before the first animated screen mounts.
store.start();

/** True while the system Reduce Motion setting is on; updates live. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(store.subscribe, store.get, () => false);
}

// ---- Tweened number (for SVG, which can't use the native driver) -----------------------------

/**
 * A number that eases toward `target` (JS driven, so only for small SVG pieces: the rings and
 * the level). `from` is where it starts on mount. With a zero duration it just follows `target`.
 */
export function useTween(target: number, kind: MotionKind, reduced: boolean, from = target): number {
  const spec = motionSpec(kind, reduced);
  const [value] = useState(() => new Animated.Value(from));
  const [shown, setShown] = useState(from);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setShown(v));
    return () => value.removeListener(id);
  }, [value]);
  useEffect(() => {
    if (spec.duration === 0) {
      value.setValue(target);
      return;
    }
    const anim = Animated.timing(value, { toValue: target, duration: spec.duration, easing: spec.easing, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [target, spec.duration, spec.easing, value]);
  return spec.duration === 0 ? target : shown;
}

/** Sweep helpers kept pure so they are easy to test. */

/** Where one 3-2-1 step's sweep ends: the share of the countdown left after this second. */
export function sweepTarget(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (value - 1) / total));
}

/** Direction of a count roll: 1 slides up (count went up), -1 slides down. */
export function rollDirection(from: number, to: number): 1 | -1 {
  return to >= from ? 1 : -1;
}
