import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, ListRow, Text } from '../../ui';
import { color } from '../../ui/tokens';
import { programCards } from '../../ui/models/goal';
import type { ProgramId } from '../../progress';
import { GoalBars } from './GoalBars';

const CARDS = programCards();

/** The three program cards and "Set my own number" (frame 2; also the goal sheet's Change program). */
export function GoalPicker({
  selected,
  onSelect,
  onCustom,
  customValue,
  elevated,
}: {
  selected: ProgramId | null;
  onSelect: (id: ProgramId) => void;
  onCustom: () => void;
  /** Shown at the right of "Set my own number" when the goal is a custom number. */
  customValue?: number | null;
  /** Cards inside a sheet use the elevated surface. */
  elevated?: boolean;
}) {
  return (
    <View>
      {CARDS.map((card) => {
        const on = selected === card.id;
        return (
          <Card
            key={card.id}
            padding={16}
            elevated={elevated}
            selected={on}
            onPress={() => onSelect(card.id)}
            accessibilityLabel={`${card.title}. ${card.summary}. ${card.length}`}
            style={styles.card}
          >
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text variant="headline">{card.title}</Text>
                <Text variant="footnote" style={styles.summary}>
                  {card.summary}
                </Text>
                <Text variant="caption" style={styles.length}>
                  {card.length}
                </Text>
              </View>
              <GoalBars bars={card.bars} lit={on} />
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" size={14} color={color.bg} /> : null}</View>
            </View>
          </Card>
        );
      })}
      <Card padding={0} elevated={elevated} style={[styles.card, styles.clip]}>
        <ListRow title="Set my own number" value={customValue != null ? String(customValue) : undefined} chevron onPress={onCustom} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12 },
  clip: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  grow: { flex: 1, minWidth: 0 },
  summary: { marginTop: 2 },
  length: { marginTop: 8 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: color.tertiary, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: color.label, borderWidth: 0 },
});
