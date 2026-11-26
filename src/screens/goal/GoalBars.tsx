import React from 'react';
import { StyleSheet, View } from 'react-native';

import { color } from '../../ui/tokens';
import type { GoalBar } from '../../ui/models/goal';

/**
 * Small chart of how the daily number grows, one bar per week (frames 2 and 5).
 * `lit`: every bar white (the picked card). Otherwise only the current week is white.
 */
export function GoalBars({ bars, lit, height = 44, width = 8 }: { bars: readonly GoalBar[]; lit?: boolean; height?: number; width?: number }) {
  return (
    <View style={[styles.row, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((b, i) => (
        <View
          key={i}
          style={[styles.bar, { width, height: Math.max(4, Math.round(b.height * height)), backgroundColor: lit || b.current ? color.label : color.graphite }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bar: { borderRadius: 2 },
});
