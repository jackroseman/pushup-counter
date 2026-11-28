import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ChallengeRecordPeriod } from '../battles/openChallenges';
import { Icon, ListGroup, ListRow, Text, color, space } from '../ui';

/** Period control for You > Challenges and the friend page. Options and ranges come from the RPC. */
export function PeriodPicker({
  periods,
  selected,
  onChange,
}: {
  periods: readonly ChallengeRecordPeriod[];
  selected: ChallengeRecordPeriod | null;
  onChange: (period: ChallengeRecordPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = selected?.label ?? 'Last 30 days';
  if (!periods.length && !selected) return null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Period: ${label}`}
        accessibilityHint="Choose a time range"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Text variant="footnote">{label}</Text>
        <Icon name="chev" size={10} color={color.tertiary} style={open ? styles.up : styles.down} />
      </Pressable>
      {open && periods.length ? (
        <ListGroup style={styles.list}>
          {periods.map((p) => (
            <ListRow
              key={p.key}
              title={p.label}
              trailing={selected?.key === p.key ? <Icon name="check" size={16} color={color.label} /> : undefined}
              onPress={() => {
                onChange(p);
                setOpen(false);
              }}
              accessibilityLabel={selected?.key === p.key ? `${p.label}, selected` : p.label}
            />
          ))}
        </ListGroup>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: space.sm },
  down: { transform: [{ rotate: '90deg' }] },
  up: { transform: [{ rotate: '-90deg' }] },
  list: { marginBottom: space.sm },
  pressed: { opacity: 0.7 },
});
