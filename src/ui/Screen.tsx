import React from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { color, gutter } from './tokens';

/**
 * Screen frame for screens that don't use the native header: safe area, 20 pt side margins,
 * a 44 pt nav bar row (left / right accessories), a large title with an optional subtitle,
 * and a scroll view. Pass `scroll={false}` for fixed layouts (set flow, sheets).
 */
export function Screen({
  title,
  subtitle,
  left,
  right,
  children,
  footer,
  scroll = true,
  safeTop = true,
  contentStyle,
}: {
  title?: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  /** Pinned below the content (primary button). */
  footer?: React.ReactNode;
  scroll?: boolean;
  /** Pad for the top safe area (false when a parent already does, e.g. today's root SafeAreaView). */
  safeTop?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const header = (
    <>
      {left || right ? (
        <View style={styles.navbar}>
          <View style={styles.side}>{left}</View>
          <View style={[styles.side, styles.right]}>{right}</View>
        </View>
      ) : null}
      {title ? (
        <Text variant="largeTitle" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {subtitle ? (
        <Text variant="subhead" style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={[styles.root, { paddingTop: safeTop ? insets.top : 0 }]}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: footer ? 16 : insets.bottom + 24 }, contentStyle]}
          contentInsetAdjustmentBehavior="never"
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.content, contentStyle]}>
          {header}
          {children}
        </View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter },
  navbar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  right: { justifyContent: 'flex-end' },
  subtitle: { marginTop: 2 },
  footer: { paddingHorizontal: gutter, paddingTop: 8 },
});
