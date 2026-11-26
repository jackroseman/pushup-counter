import React, { useEffect, useState } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { FadeIn } from './FadeIn';
import { Icon } from './Icon';
import { motionSpec, useReduceMotion, useTween } from './motion';
import { clamp01 } from './ProgressBar';
import { color } from './tokens';

/** Arc geometry shared by Ring and Countdown (round caps, starts at 12 o'clock). */
export function ringGeometry(size: number, strokeWidth: number, progress: number) {
  const r = (size - strokeWidth) / 2 - 1;
  const circumference = 2 * Math.PI * r;
  return { r, circumference, filled: circumference * clamp01(progress) };
}

/**
 * Progress ring (Today). White stroke on the ring track; when `done`, the stroke turns signal
 * green and a check sits above the center content. Center content is passed as children.
 *
 * Motion: the arc eases to `progress` (`kind="ring"`, 600 ms, from `from` on first draw, 0 by
 * default) or sweeps linearly (`kind="sweep"`, the 3-2-1 ring). The green and the check arrive
 * once the arc has filled. Reduce Motion: the arc jumps and the ring crossfades in instead.
 */
export function Ring({
  progress,
  size = 224,
  strokeWidth = 10,
  done,
  stroke,
  kind = 'ring',
  from = 0,
  children,
  style,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  done?: boolean;
  /** Override the stroke color (defaults to white, or signal when done). */
  stroke?: string;
  kind?: 'ring' | 'sweep';
  /** Progress the arc starts from the first time it is drawn. */
  from?: number;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReduceMotion();
  const target = clamp01(progress);
  const shown = useTween(target, kind, reduced, clamp01(from));
  const { r, circumference, filled } = ringGeometry(size, strokeWidth, shown);
  const c = size / 2;
  const arrived = Math.abs(shown - target) < 0.0005;
  const lit = !!done && arrived;
  const strokeColor = stroke ?? (lit ? color.signal : color.label);
  const fade = useCrossfade(target, kind === 'ring' && reduced);
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Animated.View style={{ opacity: fade }}>
        <Svg width={size} height={size}>
          <Circle cx={c} cy={c} r={r} stroke={color.fill.ringTrack} strokeWidth={strokeWidth} fill="none" />
          {filled > 0 ? (
            <Circle
              cx={c}
              cy={c}
              r={r}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
              rotation={-90}
              origin={`${c}, ${c}`}
            />
          ) : null}
        </Svg>
      </Animated.View>
      <View style={styles.center} pointerEvents="box-none">
        {lit ? (
          <FadeIn rise={0}>
            <Icon name="check" size={22} color={color.signal} style={styles.check} />
          </FadeIn>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** Reduce Motion: when `key` changes, dip the ring to 35 % and fade back (a crossfade instead of the fill). */
function useCrossfade(key: number, on: boolean): Animated.Value {
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!on) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0.35);
    const run = Animated.timing(fade, { toValue: 1, duration: motionSpec('fade', true).duration, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [key, on, fade]);
  return fade;
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  check: { marginBottom: 4 },
});
