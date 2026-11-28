import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from 'react-native';

import type { ChallengeRecordPeriod } from '../battles/openChallenges';
import { Icon, Text, color, gutter, hit, radius, space } from '../ui';

const MENU_WIDTH = 248;
const MENU_GAP = 6;

/**
 * Period control for You > Challenges and the friend page. Options and ranges come from the RPC.
 *
 * Opens as an overlay anchored to the button so the page below does not shift. The app has no
 * UIMenu dependency (that would need a new native build); this is a JS pull-down that behaves
 * the same on iOS and in the web preview.
 */
export function PeriodPicker({
  periods,
  selected,
  onChange,
  style,
}: {
  periods: readonly ChallengeRecordPeriod[];
  selected: ChallengeRecordPeriod | null;
  onChange: (period: ChallengeRecordPeriod) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const buttonRef = useRef<React.ComponentRef<typeof View>>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const label = selected?.label ?? 'Last 30 days';
  const open = anchor != null;

  if (!periods.length && !selected) return null;

  const toggle = () => {
    if (open) {
      setAnchor(null);
      return;
    }
    buttonRef.current?.measureInWindow((x: number, y: number, width: number, height: number) => {
      setAnchor({ x, y, width, height });
    });
  };

  const close = () => setAnchor(null);

  let menuStyle: ViewStyle | null = null;
  if (anchor) {
    const width = Math.min(MENU_WIDTH, windowWidth - gutter * 2);
    const left = Math.min(Math.max(gutter, anchor.x), windowWidth - width - gutter);
    const below = anchor.y + anchor.height + MENU_GAP;
    const above = anchor.y - MENU_GAP;
    const maxBelow = windowHeight - below - 24;
    const maxAbove = above - 24;
    const estimated = Math.min(periods.length, 8) * hit + 8;
    const flip = estimated > maxBelow && maxAbove > maxBelow;
    const maxHeight = Math.max(hit * 3, flip ? maxAbove : maxBelow);
    menuStyle = {
      position: 'absolute',
      left,
      width,
      maxHeight,
      ...(flip ? { bottom: windowHeight - above } : { top: below }),
    };
  }

  return (
    <View style={style}>
      <View ref={buttonRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Period: ${label}`}
          accessibilityHint="Choose a time range"
          accessibilityState={{ expanded: open }}
          onPress={toggle}
          style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        >
          <Text variant="footnote">{label}</Text>
          <Icon name="chev" size={10} color={color.tertiary} style={open ? styles.up : styles.down} />
        </Pressable>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss period menu"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          {anchor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Period: ${label}`}
              accessibilityState={{ expanded: true }}
              onPress={close}
              style={{
                position: 'absolute',
                left: anchor.x,
                top: anchor.y,
                width: Math.max(anchor.width, 44),
                height: Math.max(anchor.height, 44),
              }}
            />
          ) : null}
          {menuStyle ? (
            <View style={[styles.menu, menuStyle]} accessibilityRole="menu">
              <ScrollView bounces={false} nestedScrollEnabled>
                {periods.map((p) => {
                  const on = selected?.key === p.key;
                  return (
                    <Pressable
                      key={p.key}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={on ? `${p.label}, selected` : p.label}
                      onPress={() => {
                        onChange(p);
                        close();
                      }}
                      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                    >
                      <Text variant="body" tone="label" numberOfLines={1} style={styles.itemLabel}>
                        {p.label}
                      </Text>
                      {on ? <Icon name="check" size={16} color={color.label} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: hit,
  },
  down: { transform: [{ rotate: '90deg' }] },
  up: { transform: [{ rotate: '-90deg' }] },
  pressed: { opacity: 0.7 },
  overlay: { flex: 1 },
  menu: {
    backgroundColor: color.elevated,
    borderRadius: radius.list,
    borderWidth: 1,
    borderColor: color.separator,
    overflow: 'hidden',
    // Keep the card above the dismiss layer and the page behind it.
    zIndex: 1,
  },
  item: {
    minHeight: hit,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  itemPressed: { backgroundColor: color.fill.pressed },
  itemLabel: { flex: 1, minWidth: 0 },
});
