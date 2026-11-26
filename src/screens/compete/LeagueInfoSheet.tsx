import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Text, color, gutter, space } from '../../ui';
import { LEAGUE_INFO } from '../../progress/leagueView';

/** The league's (i) sheet: two plain lines. No formulas or thresholds. */
export function LeagueInfoSheet({ onClose }: { onClose: () => void }) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingBottom: Math.max(bottom, space.md) + space.md }]}>
      <View style={styles.header}>
        <Text variant="title2" accessibilityRole="header" style={styles.title}>
          {LEAGUE_INFO.title}
        </Text>
        <IconButton icon="xmark" accessibilityLabel="Close" onPress={onClose} />
      </View>
      {LEAGUE_INFO.lines.map((line) => (
        <Text key={line} variant="subhead" style={styles.line}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.surface, paddingHorizontal: gutter },
  header: { height: 44, marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1 },
  line: { marginTop: space.md },
});
