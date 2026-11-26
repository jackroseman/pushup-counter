import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Card } from './Card';
import { Icon } from './Icon';
import { Text } from './Text';
import { color } from './tokens';

/** done = goal hit; partial = some reps (count shown); rest = program rest day; empty = nothing yet. */
export type WeekDayState = 'done' | 'partial' | 'rest' | 'empty';

export type WeekDay = {
  /** One-letter day label (M, T, W...). */
  label: string;
  state: WeekDayState;
  /** Reps so far, shown inside a partial day. */
  count?: number;
  today?: boolean;
  /** VoiceOver label, e.g. "Wednesday, 22 of 50". */
  accessibilityLabel?: string;
};

/** Seven-day strip under Today (frames 4, 13, E3). The caller hides it on day one (E1). */
export function WeekStrip({ days, style }: { days: readonly WeekDay[]; style?: StyleProp<ViewStyle> }) {
  return (
    <Card padding={0} style={style}>
      <View style={styles.row}>
        {days.map((d, i) => (
          <View key={i} style={styles.day} accessible accessibilityLabel={d.accessibilityLabel ?? d.label}>
            <Text variant="caption" weight="600" tone={d.today ? 'label' : 'tertiary'}>
              {d.label}
            </Text>
            <View style={[styles.dot, dotStyle(d)]}>
              {d.state === 'done' ? <Icon name="check" size={14} color={color.bg} /> : null}
              {d.state === 'partial' && d.count != null ? (
                <Text style={styles.count} tabular>
                  {String(d.count)}
                </Text>
              ) : null}
              {d.state === 'rest' ? (
                <Text variant="caption" weight="400">
                  off
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function dotStyle(d: WeekDay): ViewStyle {
  switch (d.state) {
    case 'done':
      return { backgroundColor: color.label };
    case 'partial':
      return { borderWidth: 1.5, borderColor: color.label };
    case 'rest':
      return {};
    case 'empty':
      return { borderWidth: 1.5, borderColor: d.today ? color.label : color.graphite };
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14 },
  day: { width: 36, alignItems: 'center', gap: 6 },
  dot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
