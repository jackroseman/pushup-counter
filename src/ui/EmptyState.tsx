import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Button } from './Button';
import { Icon, IconName } from './Icon';
import { Text } from './Text';
import { color } from './tokens';

/**
 * Centered empty state (E7, E10–E14, frame 19): a 72 pt icon circle, a title, one plain line
 * and at most one action.
 */
export function EmptyState({
  icon,
  title,
  message,
  actionTitle,
  actionIcon,
  onAction,
  actionKind = 'primary',
  top = 110,
  style,
}: {
  icon: IconName;
  title: string;
  message?: string;
  actionTitle?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  actionKind?: 'primary' | 'gray';
  /** Space above the icon (pt). */
  top?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.wrap, { marginTop: top }, style]}>
      <View style={styles.circle}>
        <Icon name={icon} size={32} color={color.label} />
      </View>
      <Text variant="title2" align="center" style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="secondary" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} icon={actionIcon} kind={actionKind} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 16 },
  circle: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 20 },
  message: { marginTop: 8, lineHeight: 24 },
  action: { marginTop: 28 },
});
