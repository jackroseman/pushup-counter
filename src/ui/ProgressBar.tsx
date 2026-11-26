import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { color } from './tokens';

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Thin progress bar: white fill on graphite (6 pt). Goal done uses signal on signalSoft. */
export function ProgressBar({
  progress,
  fill = color.label,
  track = color.graphite,
  height = 6,
  style,
}: {
  progress: number;
  fill?: string;
  track?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = clamp01(progress);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: track }, style]}
    >
      <View style={{ width: `${p * 100}%`, height: '100%', borderRadius: height / 2, backgroundColor: fill }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden' },
});
