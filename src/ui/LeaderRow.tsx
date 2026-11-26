import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from './Avatar';
import { Text } from './Text';
import { color, space } from './tokens';

/** One league row below the podium (rank 4+): rank, avatar, name, score. Use inside a ListGroup. */
export function LeaderRow({
  rank,
  name,
  score,
  me,
  onPress,
}: {
  rank: number;
  name: string;
  score: number | string;
  me?: boolean;
  onPress?: () => void;
}) {
  const label = `${rank}. ${me ? 'You' : name}, ${score}`;
  const content = (
    <>
      <Text variant="footnote" style={styles.rank} tabular>
        {String(rank)}
      </Text>
      <Avatar name={name} me={me} size={30} />
      <Text variant="body" weight={me ? '600' : undefined} style={styles.name} numberOfLines={1}>
        {me ? 'You' : name}
      </Text>
      <Text variant="headline" weight="700" tabular style={styles.score}>
        {String(score)}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 52 },
  pressed: { backgroundColor: color.fill.pressed },
  rank: { width: 16 },
  name: { flex: 1, minWidth: 0 },
  score: { fontSize: 18, lineHeight: 22 },
});
