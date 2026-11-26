import React, { useLayoutEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { motionSpec, rollDirection, useReduceMotion } from './motion';

type Roll = { cur: number; prev: number | null; dir: 1 | -1; anim: Animated.Value | null };

/**
 * A big number that rolls to its next value: the new number slides in from below (or above when
 * it goes down) while the old one slides out, both fading, in 180 ms. Reduce Motion: a plain
 * crossfade, no slide. Nothing is masked, so the glyph tops are never clipped (#52: the Text
 * keeps its full line height and negative margins). The new value is on screen at once and
 * the animation runs on the native driver, so a fast count never waits on it. No animation on
 * first render.
 */
export function RollingNumber({
  value,
  render,
  distance = 24,
}: {
  value: number;
  /** Draws one number with the caller's own Text style (the style is the same for both layers). */
  render: (value: number) => React.ReactNode;
  /** Slide distance in pt (about 0.13 of the font size). */
  distance?: number;
}) {
  const reduced = useReduceMotion();
  const [roll, setRoll] = useState<Roll>({ cur: value, prev: null, dir: 1, anim: null });
  if (roll.cur !== value) {
    // Adjust state while rendering (React's pattern for "state derived from a prop change").
    setRoll({ cur: value, prev: roll.cur, dir: rollDirection(roll.cur, value), anim: new Animated.Value(0) });
  }
  const { anim } = roll;
  useLayoutEffect(() => {
    if (!anim) return;
    const spec = motionSpec('roll', reduced);
    const run = Animated.timing(anim, { toValue: 1, duration: spec.duration, easing: spec.easing, useNativeDriver: true });
    run.start(({ finished }) => {
      if (finished) setRoll((r) => (r.anim === anim ? { ...r, prev: null, anim: null } : r));
    });
    return () => run.stop();
  }, [anim, reduced]);

  const move = !reduced;
  const enter = anim ? { opacity: anim, transform: move ? [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [roll.dir * distance, 0] }) }] : [] } : null;
  const leave =
    anim && roll.prev !== null
      ? {
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: move ? [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -roll.dir * distance] }) }] : [],
        }
      : null;
  return (
    <View>
      <Animated.View style={enter}>{render(roll.cur)}</Animated.View>
      {leave && roll.prev !== null ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.leaving, leave]}
        >
          {render(roll.prev)}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  leaving: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
});
