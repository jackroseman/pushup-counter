import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DayGroup, RangeChart, SetRange, groupByDay, rangeChart } from '../progress/allSets';
import { SessionRecord } from '../storage/history';
import { Card, EmptyState, Icon, ListGroup, Pill, SectionHeader, Segmented, Text, color, gutter } from '../ui';

const RANGES = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
] as const;

const BAR_H = 70;

function Bars({ chart }: { chart: RangeChart }) {
  const max = Math.max(1, ...chart.bars.map((b) => b.value));
  const dense = chart.bars.length > 12;
  return (
    <View style={[styles.bars, { gap: dense ? 3 : 10 }]}>
      {chart.bars.map((b) => {
        const h = b.value > 0 ? Math.max(4, (b.value / max) * BAR_H) : 3;
        const fill = b.value === 0 ? color.graphite : b.state === 'current' ? color.label : color.tertiary;
        return (
          <View key={b.key} style={styles.barCol}>
            <View style={{ height: h, alignSelf: 'stretch', borderRadius: 3, backgroundColor: fill }} />
            <Text variant="caption" style={styles.barLabel} numberOfLines={1}>
              {b.label || ' '}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Day({ group, onOpen }: { group: DayGroup<SessionRecord>; onOpen: (r: SessionRecord) => void }) {
  return (
    <>
      <SectionHeader title={group.label} action={String(group.total)} />
      <ListGroup>
        {group.rows.map((row) => (
          <Pressable
            key={row.record.id}
            onPress={() => onOpen(row.record)}
            accessibilityRole="button"
            accessibilityLabel={`${row.reps} reps at ${row.time}${row.best ? ', best set' : ''}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text variant="hero" size={20} style={styles.reps} adjustsFontSizeToFit numberOfLines={1}>
              {String(row.reps)}
            </Text>
            <Text variant="subhead" style={styles.time}>
              {row.time}
            </Text>
            {row.best ? <Pill label="Best" size="small" /> : null}
            <Icon name="chev" size={13} color={color.tertiary} />
          </Pressable>
        ))}
      </ListGroup>
    </>
  );
}

/** All sets (frame 15, E7): Week / Month / Year totals and every set by day. */
export function AllSetsScreen({
  records,
  now,
  timeZone,
  onOpen,
  onStart,
}: {
  /** Null while loading. */
  records: SessionRecord[] | null;
  now: number;
  timeZone: string;
  onOpen: (r: SessionRecord) => void;
  onStart: () => void;
}) {
  const [range, setRange] = useState<SetRange>('week');
  if (records === null) return <View style={styles.container} />;
  if (records.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="chart"
          title="No sets yet"
          message="Every set you do shows up here."
          actionTitle="Start a set"
          actionIcon="play"
          onAction={onStart}
          top={170}
        />
      </View>
    );
  }
  const chart = rangeChart(records, range, now, timeZone);
  const days = groupByDay(records, now, timeZone);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Segmented options={RANGES} value={range} onChange={setRange} style={styles.segmented} />
      <Card style={styles.chartCard}>
        <View style={styles.chartHead}>
          <Text variant="hero" size={30}>
            {String(chart.total)}
          </Text>
          <Text variant="footnote">{chart.label}</Text>
        </View>
        <Bars chart={chart} />
      </Card>
      {days.map((g) => (
        <Day key={g.date} group={g} onOpen={onOpen} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg, paddingHorizontal: gutter },
  scroll: { paddingBottom: 32 },
  segmented: { marginTop: 10 },
  chartCard: { marginTop: 12 },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: BAR_H + 20, marginTop: 12 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  barLabel: { height: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 },
  pressed: { backgroundColor: color.fill.pressed },
  reps: { width: 40 },
  time: { flex: 1 },
});
