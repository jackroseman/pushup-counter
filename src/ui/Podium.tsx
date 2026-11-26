import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Text } from './Text';
import { color } from './tokens';

export type PodiumEntry = { name: string; score: number | string; me?: boolean };

const HEIGHT = [124, 96, 74];

/** Top three of the league (frame 18), drawn 2nd · 1st · 3rd. Pass entries in rank order. */
export function Podium({ entries, style }: { entries: readonly PodiumEntry[]; style?: StyleProp<ViewStyle> }) {
  const order = [1, 0, 2].filter((rank) => entries[rank]);
  return (
    <View style={[styles.row, style]}>
      {order.map((rank) => {
        const e = entries[rank];
        return (
          <View key={rank} style={styles.col} accessible accessibilityLabel={`${rank + 1}. ${e.me ? 'You' : e.name}, ${e.score}`}>
            {rank === 0 ? <Icon name="crown" size={16} color={color.label} style={styles.crown} /> : null}
            <Avatar name={e.name} me={e.me} size={rank === 0 ? 52 : 44} />
            <Text variant="headline" style={styles.name} numberOfLines={1}>
              {e.me ? 'You' : e.name}
            </Text>
            <Text variant="footnote" tabular>
              {String(e.score)}
            </Text>
            <View style={[styles.block, { height: HEIGHT[rank] }]}>
              <Text variant="title2" tone="secondary" tabular>
                {String(rank + 1)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  col: { width: 96, alignItems: 'center' },
  crown: { marginBottom: 4 },
  name: { fontSize: 14, marginTop: 6 },
  block: { alignSelf: 'stretch', marginTop: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: color.elevated, alignItems: 'center', paddingTop: 8 },
});
