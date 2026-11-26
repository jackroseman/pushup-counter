import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Text } from './Text';

/** Space between the top safe area and the tab title row. */
export const TAB_HEADER_TOP = 8;
/** Height of the title row: fits the 34 pt large title and 36 pt icon buttons. */
export const TAB_HEADER_ROW = 44;

/**
 * The large title at the top of a tab (Today, Compete, You). One component so the title sits
 * at the same top offset, inset, font and size on every tab. Actions sit on the right of the
 * title row; an optional subtitle (Today's date) sits under it. The caller gives the side inset
 * (the screen gutter).
 */
export function TabHeader({
  title,
  subtitle,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <Text variant="largeTitle" accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {subtitle ? (
        <Text variant="subhead" style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: TAB_HEADER_TOP },
  row: { minHeight: TAB_HEADER_ROW, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subtitle: { marginTop: 2 },
});
