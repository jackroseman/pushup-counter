import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { qualityLabel } from '../core';
import { useSession } from '../session/useSession';
import { SessionRecord } from '../storage/history';
import { Settings } from '../storage/settings';
import { colors } from '../theme';

export function SessionScreen({
  settings,
  onFinished,
  onCancel,
}: {
  settings: Settings;
  onFinished: (record: SessionRecord) => void;
  onCancel: () => void;
}) {
  const { state, finish } = useSession(settings);
  const last = state.lastRep;

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{state.status}</Text>

      <View style={styles.center}>
        <Text style={styles.count} accessibilityLabel={`${state.count} pushups`}>
          {state.count}
        </Text>
        <Text style={styles.countLabel}>{state.phase === 'calibrating' ? 'calibrating' : 'pushups'}</Text>

        {last ? (
          <View style={[styles.badge, { backgroundColor: colors.quality[last.quality] }]}>
            <Text style={styles.badgeText}>
              Rep {last.index}: {qualityLabel(last.quality)}
            </Text>
            {last.rangeOfMotion !== null ? (
              <Text style={styles.badgeSub}>
                {(last.rangeOfMotion * 100).toFixed(0)} cm range{last.faceLostAtBottom ? ' (face lost at bottom)' : ''}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.indicators}>
        <Indicator label="Proximity" ok={state.proximityAvailable} />
        <Indicator label="Depth" ok={state.faceTracking && state.calibratedTop !== null} />
        {state.faceTracking ? <Indicator label="Face" ok={state.faceVisible} /> : null}
      </View>

      {state.phase === 'starting' || state.phase === 'calibrating' ? (
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      ) : (
        <Button title="End set" kind="danger" onPress={async () => onFinished(await finish())} />
      )}
    </View>
  );
}

function Indicator({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={styles.indicator}>
      <View style={[styles.dot, { backgroundColor: ok ? colors.quality.full : colors.muted }]} />
      <Text style={styles.indicatorText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingBottom: 32 },
  status: { color: colors.muted, fontSize: 16, textAlign: 'center', marginTop: 12, minHeight: 44 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  count: { color: colors.text, fontSize: 180, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.muted, fontSize: 20, marginTop: -16, textTransform: 'uppercase', letterSpacing: 2 },
  badge: { marginTop: 28, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center' },
  badgeText: { color: '#111', fontSize: 22, fontWeight: '800' },
  badgeSub: { color: '#111', fontSize: 14, marginTop: 2 },
  indicators: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  indicator: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  indicatorText: { color: colors.muted, fontSize: 14 },
});
