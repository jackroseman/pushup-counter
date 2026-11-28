// Preview-only stand-in for src/ui/MenuPicker.tsx. The app uses a native SwiftUI
// menu on iOS; this keeps the web preview's scripted flows and screenshots working.
import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Icon } from '../../../src/ui/Icon';
import { Text } from '../../../src/ui/Text';
import { color, hit, radius, space } from '../../../src/ui/tokens';

export type MenuPickerOption<K extends string> = { key: K; label: string };

export function MenuPicker<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: {
  options: readonly MenuPickerOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const buttonRef = useRef<React.ComponentRef<typeof View>>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  if (!options.length) return null;
  const selected = options.find((o) => o.key === value) ?? options[0];
  const open = anchor != null;

  const toggle = () => {
    if (open) {
      setAnchor(null);
      return;
    }
    buttonRef.current?.measureInWindow((x: number, y: number, _w: number, height: number) => {
      setAnchor({ x, y, height });
    });
  };

  return (
    <View style={style}>
      <View ref={buttonRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ expanded: open }}
          onPress={toggle}
          style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        >
          <Text variant="footnote" tone="label" weight="500">
            {selected.label}
          </Text>
          <Icon name="chev" size={10} color={color.tertiary} style={open ? styles.up : styles.down} />
        </Pressable>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setAnchor(null)}>
        <View style={styles.overlay} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss menu"
            onPress={() => setAnchor(null)}
            style={StyleSheet.absoluteFill}
          />
          {anchor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityState={{ expanded: true }}
              onPress={() => setAnchor(null)}
              style={{
                position: 'absolute',
                left: anchor.x,
                top: anchor.y,
                width: 200,
                height: Math.max(anchor.height, 44),
              }}
            />
          ) : null}
          {anchor ? (
            <View
              style={[styles.menu, { top: anchor.y + anchor.height + 6, left: Math.max(20, anchor.x) }]}
              accessibilityRole="menu"
            >
              {options.map((o) => {
                const on = o.key === value;
                return (
                  <Pressable
                    key={o.key}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={on ? `${o.label}, selected` : o.label}
                    onPress={() => {
                      onChange(o.key);
                      setAnchor(null);
                    }}
                    style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                  >
                    <Text variant="body" tone="label" numberOfLines={1} style={styles.itemLabel}>
                      {o.label}
                    </Text>
                    {on ? <Icon name="check" size={16} color={color.label} /> : null}
                  </Pressable>
                );
              })}
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
    position: 'absolute',
    width: 248,
    backgroundColor: color.elevated,
    borderRadius: radius.list,
    borderWidth: 1,
    borderColor: color.separator,
    overflow: 'hidden',
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
