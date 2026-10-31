import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../theme';

export function Button({
  title,
  onPress,
  kind = 'primary',
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : colors.card;
  const fg = kind === 'secondary' ? colors.text : '#111';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }, style]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Stat({ label, value, small, color }: { label: string; value: string; small?: boolean; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, small && styles.statValueSmall, color ? { color } : null]} numberOfLines={2} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  buttonText: { fontSize: 18, fontWeight: '700' },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 14, padding: 14, margin: 4, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  statValueSmall: { fontSize: 18 },
  statLabel: { color: colors.muted, fontSize: 13, marginTop: 4, textAlign: 'center' },
});
