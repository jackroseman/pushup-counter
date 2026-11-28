import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { color, radius } from '../../../src/ui/tokens';

export type SegmentedOption<K extends string> = { key: K; label: string };

/** Preview-only stand-in for src/ui/Segmented.tsx. The app uses a native SwiftUI segmented control on iOS. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            hitSlop={5}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', height: 34, padding: 2, borderRadius: radius.segmented, backgroundColor: color.fill.segmentTrack },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.segmented - 2 },
  itemOn: { backgroundColor: color.fill.segmentOn },
  label: { color: color.label, fontSize: 14, fontWeight: '500' },
  labelOn: { fontWeight: '600' },
});
