import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from './Icon';
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
 */
export function Ring({
  progress,
  size = 224,
  strokeWidth = 10,
  done,
  stroke,
  children,
  style,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  done?: boolean;
  /** Override the stroke color (defaults to white, or signal when done). */
  stroke?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { r, circumference, filled } = ringGeometry(size, strokeWidth, progress);
  const c = size / 2;
  const strokeColor = stroke ?? (done ? color.signal : color.label);
  return (
    <View style={[{ width: size, height: size }, style]}>
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
      <View style={styles.center} pointerEvents="box-none">
        {done ? <Icon name="check" size={22} color={color.signal} style={styles.check} /> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  check: { marginBottom: 4 },
});
