import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { LiveDistanceChart } from '../components/charts';
import { qualityLabel } from '../core';
import { LIVE_WINDOW_MS, useSession } from '../session/useSession';
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
  const { state, finish, live } = useSession(settings);
  const last = state.lastRep;

  if (state.phase === 'unavailable') {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.unavailableTitle}>Can't count reps</Text>
          <Text style={styles.unavailableText}>{state.status}</Text>
        </View>
        <Button title="Back" kind="secondary" onPress={onCancel} />
      </View>
    );
  }

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
              {last.depthRatio !== null ? ` · ${Math.round(last.depthRatio * 100)}%` : ''}
            </Text>
            <Text style={styles.badgeSub}>
              {last.descentMs != null && last.ascentMs != null
                ? `down ${(last.descentMs / 1000).toFixed(1)}s · up ${(last.ascentMs / 1000).toFixed(1)}s`
                : ''}
              {last.intervalMs != null ? ` · ${(last.intervalMs / 1000).toFixed(1)}s since last` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.chartTitle}>Face distance (last {Math.round(LIVE_WINDOW_MS / 1000)} s)</Text>
      <LiveDistanceChart source={live} windowMs={LIVE_WINDOW_MS} fps={12} height={170} />

      <View style={styles.indicators}>
        <Indicator label="Face" ok={state.faceVisible} />
        <Indicator label="Calibrated" ok={state.calibratedTop !== null} />
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
  count: { color: colors.text, fontSize: 130, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.muted, fontSize: 18, marginTop: -10, textTransform: 'uppercase', letterSpacing: 2 },
  badge: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, alignItems: 'center' },
  badgeText: { color: '#111', fontSize: 20, fontWeight: '800' },
  badgeSub: { color: '#111', fontSize: 13, marginTop: 2 },
  chartTitle: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  indicators: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  indicator: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  indicatorText: { color: colors.muted, fontSize: 14 },
  unavailableTitle: { color: colors.text, fontSize: 26, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  unavailableText: { color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
});
