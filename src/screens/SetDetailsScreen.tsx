import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { PaceCurve } from '../components/charts';
import { setDetails } from '../progress/summaryModel';
import { SessionRecord } from '../storage/history';
import { Card, FormSplitBar, IconButton, ListGroup, ListRow, SectionHeader, StatTile, Text, color, gutter } from '../ui';

/** Set details (frame 12): overall reps, time, pace and depth for one set. No rep-by-rep table. */
export function SetDetailsScreen({
  record,
  onBack,
  onDelete,
}: {
  record: SessionRecord;
  onBack: () => void;
  onDelete: () => void;
}) {
  const m = useMemo(() => setDetails(record), [record]);
  const confirmDelete = () =>
    Alert.alert('Delete this set?', 'It is removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <IconButton icon="back" onPress={onBack} accessibilityLabel="Back" />
        <Text variant="headline" style={styles.title} accessibilityRole="header">
          Set details
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text variant="subhead" style={styles.date}>
          {m.date}
        </Text>
        <View style={styles.tiles}>
          <StatTile label="Reps" value={String(m.reps)} size={28} compact />
          <StatTile label="Time" value={m.time} size={28} compact />
          <StatTile label="Pace" value={m.pace} size={28} compact />
        </View>
        <SectionHeader title="Depth" />
        <Card>
          <View style={styles.depthHead}>
            <Text variant="hero" size={32}>
              {m.depthPct}
            </Text>
            <Text variant="footnote">{m.depthCaption}</Text>
          </View>
          <FormSplitBar split={m.split} style={styles.split} />
        </Card>
        <SectionHeader title="Pace" />
        <Card>
          <PaceCurve values={m.paceSeries} />
          <Text variant="footnote" style={styles.paceLine}>
            {m.paceLine}
          </Text>
        </Card>
        <ListGroup style={styles.delete}>
          <ListRow title="Delete set" destructive onPress={confirmDelete} />
        </ListGroup>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: gutter, backgroundColor: color.bg },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center' },
  title: { position: 'absolute', left: 56, right: 56, textAlign: 'center' },
  scroll: { paddingBottom: 32 },
  date: { marginTop: 10 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 12 },
  depthHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  split: { marginTop: 14 },
  paceLine: { marginTop: 6 },
  delete: { marginTop: 20 },
});
