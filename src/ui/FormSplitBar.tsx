import React from 'react';
import { StyleProp, StyleSheet, Text as RNText, View, ViewStyle } from 'react-native';

import { Text } from './Text';
import { color } from './tokens';

export type FormSplit = { full: number; good: number; shallow: number };

/** Segments with a count above zero, in display order. */
export function splitSegments(split: FormSplit) {
  return (
    [
      { key: 'full', count: split.full, color: color.quality.full },
      { key: 'good', count: split.good, color: color.quality.good },
      { key: 'shallow', count: split.shallow, color: color.quality.shallow },
    ] as const
  ).filter((s) => s.count > 0);
}

/** How a set's reps split by depth (frames 11, 12): a segmented 8 pt bar and a one-line legend. */
export function FormSplitBar({ split, style }: { split: FormSplit; style?: StyleProp<ViewStyle> }) {
  const segments = splitSegments(split);
  return (
    <View style={style} accessible accessibilityLabel={`${split.full} full, ${split.good} good, ${split.shallow} too shallow`}>
      <View style={styles.bar}>
        {segments.length ? (
          segments.map((s) => <View key={s.key} style={{ flex: s.count, backgroundColor: s.color }} />)
        ) : (
          <View style={{ flex: 1, backgroundColor: color.graphite }} />
        )}
      </View>
      <View style={styles.legend}>
        <Text variant="footnote">
          <RNText style={[styles.n, { color: color.signal }]}>{split.full}</RNText> full
        </Text>
        <Text variant="footnote">
          <RNText style={styles.n}>{split.good}</RNText> good
        </Text>
        <Text variant="footnote">
          <RNText style={styles.n}>{split.shallow}</RNText> too shallow
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', gap: 16, marginTop: 10 },
  n: { color: color.label, fontWeight: '700' },
});
