import React from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { usePressScale } from './Button';
import { Icon, IconName } from './Icon';
import { color, hit } from './tokens';

const SIZE = 36;

/** Circular nav-bar action (back, close, gear, +, •••). 36 pt circle with a 44 pt hit target. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { scale, opacity, onPressIn, onPressOut } = usePressScale();
  const slop = (hit - SIZE) / 2;
  return (
    <Animated.View style={[{ opacity, transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        hitSlop={slop}
        style={styles.circle}
      >
        <Icon name={icon} size={17} color={color.label} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: color.fill.tinted },
});
