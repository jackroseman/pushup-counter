import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { historyStore } from '../session/useSession';
import { SessionRecord } from '../storage/history';
import { analyzeSet } from '../core';
import { colors } from '../theme';

export function HistoryScreen({ onOpen, onBack }: { onOpen: (r: SessionRecord) => void; onBack: () => void }) {
  const [items, setItems] = useState<SessionRecord[] | null>(null);

  useEffect(() => {
    historyStore.load().then(setItems, () => setItems([]));
  }, []);

  const total = (items ?? []).reduce((n, r) => n + r.summary.totalReps, 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>History</Text>
      <Text style={styles.sub}>{items ? `${items.length} sets · ${total} pushups` : 'Loading…'}</Text>
      <FlatList
        style={{ flex: 1 }}
        data={items ?? []}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={items ? <Text style={styles.empty}>No sets yet. Go do some pushups!</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{item.summary.totalReps} pushups</Text>
              <Text style={styles.itemSub}>{new Date(item.startedAt).toLocaleString()}</Text>
              <Text style={styles.itemSub}>{historyLine(item)}</Text>
            </View>
            <Text style={styles.itemPct}>{item.summary.percentFull}% full</Text>
          </Pressable>
        )}
      />
      {items && items.length > 0 ? (
        <Button
          title="Clear history"
          kind="secondary"
          onPress={() =>
            Alert.alert('Clear history?', 'This deletes every set saved on this phone. Sets already backed up to your account are kept.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: () => historyStore.clear().then(() => setItems([])) },
            ])
          }
        />
      ) : null}
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  sub: { color: colors.muted, fontSize: 14, marginBottom: 12 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40, fontSize: 16 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 8 },
  itemTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  itemSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  itemPct: { color: colors.quality.full, fontSize: 16, fontWeight: '700' },
});

/** One-line tempo/depth recap for the history list. */
function historyLine(r: SessionRecord): string {
  const a = analyzeSet(r.reps, r.startedAt, r.endedAt);
  const parts: string[] = [];
  if (a.avgIntervalSec !== null) parts.push(`${a.avgIntervalSec.toFixed(1)} s/rep`);
  if (a.avgDepthPct !== null) parts.push(`${a.avgDepthPct}% depth`);
  parts.push('Tap for analysis ›');
  return parts.join(' · ');
}
