import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Button, Stat } from '../components/ui';
import { qualityLabel } from '../core';
import { SessionRecord } from '../storage/history';
import { colors } from '../theme';

export function SummaryScreen({ record, onDone }: { record: SessionRecord; onDone: () => void }) {
  const s = record.summary;
  const mins = Math.floor(s.durationSec / 60);
  const secs = s.durationSec % 60;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set complete</Text>
      <Text style={styles.date}>{new Date(record.startedAt).toLocaleString()}</Text>

      <View style={styles.row}>
        <Stat label="Total reps" value={String(s.totalReps)} />
        <Stat label="Full depth" value={`${s.percentFull}%`} />
      </View>
      <View style={styles.row}>
        <Stat label="Avg range of motion" value={s.avgRangeOfMotionCm === null ? '—' : `${s.avgRangeOfMotionCm.toFixed(0)} cm`} />
        <Stat label="Time" value={`${mins}:${String(secs).padStart(2, '0')}`} />
      </View>
      <View style={styles.row}>
        <Stat label="Full" value={String(s.fullReps)} />
        <Stat label="Good" value={String(s.goodReps)} />
        <Stat label="Shallow" value={String(s.shallowReps)} />
      </View>
      {!record.depthTracking ? (
        <Text style={styles.note}>Depth camera wasn't used, so every counted rep is scored Full (chest touched the phone).</Text>
      ) : null}

      <FlatList
        style={styles.list}
        data={record.reps}
        keyExtractor={(r) => String(r.index)}
        renderItem={({ item }) => (
          <View style={styles.repRow}>
            <Text style={styles.repIndex}>#{item.index}</Text>
            <Text style={[styles.repQuality, { color: colors.quality[item.quality] }]}>{qualityLabel(item.quality)}</Text>
            <Text style={styles.repMeta}>
              {item.rangeOfMotion !== null ? `${(item.rangeOfMotion * 100).toFixed(0)} cm` : ''}
              {item.source === 'depth' ? ' · depth only' : ''}
              {item.faceLostAtBottom && item.rangeOfMotion !== null ? ' · face lost' : ''}
            </Text>
          </View>
        )}
      />
      <Button title="Done" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  date: { color: colors.muted, fontSize: 14, marginBottom: 12 },
  row: { flexDirection: 'row', marginHorizontal: -4 },
  note: { color: colors.muted, fontSize: 13, marginTop: 8 },
  list: { flex: 1, marginTop: 12 },
  repRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3145' },
  repIndex: { color: colors.muted, width: 48, fontSize: 15 },
  repQuality: { width: 80, fontSize: 16, fontWeight: '700' },
  repMeta: { color: colors.muted, fontSize: 14, flex: 1 },
});
