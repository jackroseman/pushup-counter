import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { color, radius, space } from './tokens';

/** Surface card: #111113, 16 pt corners, 1 pt separator border. `elevated` for cards inside sheets. */
export function Card({
  children,
  padding = space.md,
  elevated,
  selected,
  onPress,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  padding?: number;
  elevated?: boolean;
  /** 1.5 pt white border (picked option). */
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const cardStyle = [
    styles.card,
    { padding },
    elevated && styles.elevated,
    selected && styles.selected,
    style,
  ];
  if (!onPress) return <View style={cardStyle}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.separator },
  elevated: { backgroundColor: color.elevated },
  selected: { borderWidth: 1.5, borderColor: color.label },
  pressed: { opacity: 0.8 },
});
