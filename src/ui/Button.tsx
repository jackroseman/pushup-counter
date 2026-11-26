import React, { useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';

import { Icon, IconName } from './Icon';
import { color, motion, radius } from './tokens';

export type ButtonKind = 'primary' | 'gray' | 'tinted' | 'plain' | 'destructive';

const KIND: Record<ButtonKind, { bg: string; fg: string }> = {
  primary: { bg: color.label, fg: color.bg },
  gray: { bg: color.elevated, fg: color.label },
  tinted: { bg: color.fill.tinted, fg: color.label },
  plain: { bg: 'transparent', fg: color.secondary },
  /** Destructive text button (no fill). */
  destructive: { bg: 'transparent', fg: color.destructive },
};

/** Animated press feedback shared by buttons: scale 0.98, 120 ms, ease-out, no bounce. */
export function usePressScale() {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) =>
    Animated.timing(scale, { toValue: value, duration: motion.press, easing: motion.easing, useNativeDriver: true }).start();
  return { scale, onPressIn: () => to(motion.pressScale), onPressOut: () => to(1) };
}

/**
 * Capsule button. `size="large"` is the 56 pt full-width button; `size="small"` is the 34 pt
 * inline button (Play, Invite, Accept). `plain` and `destructive` are text-only (48 pt).
 */
export function Button({
  title,
  onPress,
  kind = 'primary',
  size = 'large',
  icon,
  disabled,
  loading,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  size?: 'large' | 'small';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const k = KIND[kind];
  const textOnly = kind === 'plain' || kind === 'destructive';
  const small = size === 'small';
  return (
    <Animated.View style={[small ? styles.wrapSmall : styles.wrap, { transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        hitSlop={small ? 5 : undefined}
        style={[
          styles.base,
          small ? styles.small : textOnly ? styles.text : styles.large,
          { backgroundColor: k.bg, opacity: disabled ? 0.4 : 1 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={k.fg} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={small ? 15 : 17} color={k.fg} /> : null}
            <Text style={[styles.title, small && styles.titleSmall, { color: k.fg }]} numberOfLines={1}>
              {title}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  wrapSmall: { alignSelf: 'flex-start' },
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.capsule },
  large: { height: 56 },
  text: { height: 48 },
  small: { height: 34, paddingHorizontal: 16 },
  title: { fontSize: 17, fontWeight: '600' },
  titleSmall: { fontSize: 15 },
});
