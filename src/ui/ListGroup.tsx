import React from 'react';
import { Pressable, StyleProp, StyleSheet, Switch, View, ViewStyle } from 'react-native';

import { Icon, IconName } from './Icon';
import { Text } from './Text';
import { color, radius, space } from './tokens';

/** Inset grouped list (iOS Settings style). Draws the separators between its rows. */
export function ListGroup({
  children,
  inset = space.md,
  elevated,
  style,
}: {
  children: React.ReactNode;
  /** Left inset of the separators: 16 for plain rows, 56 for rows with an icon tile. */
  inset?: number;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, elevated && styles.elevated, style]}>
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={[styles.separator, { marginLeft: inset }]} /> : null}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

/** Separator inset for groups whose rows have an icon tile (as in the Settings mockup). */
export const ICON_ROW_INSET = 56;

/** Section header above a group ("Recent sets", "Friends · 5"), with an optional action on the right. */
export function SectionHeader({
  title,
  action,
  onAction,
  style,
}: {
  title: string;
  /** Right-side text (a link such as "See all", or a value). */
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text variant="footnote" weight="500">
        {title}
      </Text>
      {action ? (
        onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={12}>
            <Text variant="footnote" weight="500" tone="label">
              {action}
            </Text>
          </Pressable>
        ) : (
          <Text variant="footnote" weight="500">
            {action}
          </Text>
        )
      ) : null}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  value,
  trailing,
  chevron,
  switchValue,
  onSwitchChange,
  destructive,
  onPress,
  minHeight = 52,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  /** Icon tile (30 pt graphite square, white glyph). */
  icon?: IconName;
  /** Any leading element instead of the icon tile (avatar, rank). */
  leading?: React.ReactNode;
  /** Secondary text on the right. */
  value?: string;
  /** Any trailing element (pill, small button). */
  trailing?: React.ReactNode;
  chevron?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
  destructive?: boolean;
  onPress?: () => void;
  minHeight?: number;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      {icon ? (
        <View style={styles.tile}>
          <Icon name={icon} size={16} color={color.label} />
        </View>
      ) : null}
      {leading}
      <View style={styles.grow}>
        <Text variant="body" tone={destructive ? 'destructive' : 'label'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="secondary" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {switchValue !== undefined ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{ true: color.signal, false: color.fill.switchOff }}
          ios_backgroundColor={color.fill.switchOff}
          thumbColor={color.label}
          accessibilityLabel={title}
        />
      ) : null}
      {chevron ? <Icon name="chev" size={13} color={color.tertiary} /> : null}
    </>
  );
  if (!onPress) {
    return <View style={[styles.row, { minHeight }]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { minHeight }, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: color.surface, borderRadius: radius.list, borderWidth: 1, borderColor: color.separator, overflow: 'hidden' },
  elevated: { backgroundColor: color.elevated },
  separator: { height: 1, backgroundColor: color.separator },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.xs, marginHorizontal: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  pressed: { backgroundColor: color.fill.pressed },
  tile: { width: 30, height: 30, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center', backgroundColor: color.graphite },
  grow: { flex: 1, minWidth: 0 },
});
