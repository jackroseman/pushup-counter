import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { color } from './tokens';

export function initialOf(name: string): string {
  const trimmed = name.trim().replace(/^@/, '');
  return trimmed ? [...trimmed][0].toUpperCase() : '?';
}

/** Initial on a graphite circle; the user's own avatar ("you") is white with a black initial. */
export function Avatar({
  name,
  size = 34,
  me,
  ringColor,
  style,
}: {
  name: string;
  size?: number;
  me?: boolean;
  /** 2 pt ring in the surface color, for overlapping stacks. */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const circle = (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: me ? color.label : color.graphite },
        ringColor ? null : style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.4), color: me ? color.bg : color.label }]}>{initialOf(name)}</Text>
    </View>
  );
  if (!ringColor) return circle;
  return <View style={[{ borderWidth: 2, borderColor: ringColor, borderRadius: size / 2 + 2 }, style]}>{circle}</View>;
}

/** Overlapping avatars (Today league card, Compete sign-in). */
export function AvatarStack({
  people,
  size = 28,
  overlap = 8,
  ringColor = color.surface,
  style,
}: {
  people: { name: string; me?: boolean }[];
  size?: number;
  overlap?: number;
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.stack, style]}>
      {people.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} me={p.me} size={size} ringColor={ringColor} style={i ? { marginLeft: -overlap } : null} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '600' },
  stack: { flexDirection: 'row' },
});
