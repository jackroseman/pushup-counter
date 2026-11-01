import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FaceMeshView } from '../../modules/pushup-sensors';
import { Button } from '../components/ui';
import { LiveDistanceChart } from '../components/charts';
import { CalibrationPanel } from '../components/calibration';
import { qualityLabel } from '../core';
import { BattleSessionOptions, LIVE_WINDOW_MS, useSession } from '../session/useSession';
import { SessionRecord } from '../storage/history';
import { Settings } from '../storage/settings';
import { colors } from '../theme';

export function SessionScreen({
  settings,
  onFinished,
  onCancel,
  battle,
}: {
  settings: Settings;
  battle?: BattleSessionOptions;
  onFinished: (record: SessionRecord) => void;
  onCancel: () => void;
}) {
  const { state, finish, live, recalibrate } = useSession(settings, battle);
  const [liveView, setLiveView] = useState<'chart' | 'face'>('chart');
  const last = state.lastRep;
  const done = useRef(false);
  const end = async () => {
    const record = await finish();
    if (done.current) return;
    done.current = true;
    onFinished(record);
  };
  useEffect(() => {
    if (state.autoEnd) end();
  }, [state.autoEnd]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (state.phase === 'calibrating' || state.phase === 'locked') {
    const locked = state.phase === 'locked' && state.calibratedTop !== null;
    return (
      <View style={styles.container}>
        <Text style={styles.status}>{state.status}</Text>
        <View style={styles.faceBox}>
          <FaceMeshView style={StyleSheet.absoluteFill} showAngles />
          {locked ? (
            <View style={styles.lockedOverlay} pointerEvents="none">
              <Text style={styles.lockedLabel}>TOP LOCKED</Text>
              <Text style={styles.lockedValue}>{Math.round(state.calibratedTop! * 100)} cm</Text>
              <Text style={styles.lockedSub}>Starting in {state.countdown ?? 0}…</Text>
            </View>
          ) : null}
        </View>
        {locked ? null : <CalibrationPanel guide={state.guide} />}
        {locked ? <Button title="Redo calibration" kind="secondary" onPress={recalibrate} /> : null}
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{state.status}</Text>
      {battle ? (
        <Text style={styles.battleClock} accessibilityLiveRegion="polite">
          {battle.format === 'timed' ? state.battleClock || '' : state.battleClock || 'Max reps · ends after a pause'}
        </Text>
      ) : null}

      <View style={styles.center}>
        <Text style={styles.count} accessibilityLabel={`${state.count} pushups`}>
          {state.count}
        </Text>
        <Text style={styles.countLabel}>pushups</Text>

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

      <View style={styles.liveHeader}>
        <Text style={styles.chartTitle}>
          {liveView === 'chart' ? `Face distance (last ${Math.round(LIVE_WINDOW_MS / 1000)} s)` : 'Face (TrueDepth)'}
        </Text>
        <View style={styles.segment}>
          {(['chart', 'face'] as const).map((v) => (
            <Pressable
              key={v}
              onPress={() => setLiveView(v)}
              style={[styles.segmentItem, liveView === v && styles.segmentItemOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: liveView === v }}
            >
              <Text style={[styles.segmentText, liveView === v && styles.segmentTextOn]}>
                {v === 'chart' ? 'Chart' : 'Face'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {liveView === 'chart' ? (
        <LiveDistanceChart source={live} windowMs={LIVE_WINDOW_MS} fps={12} height={170} />
      ) : (
        <FaceMeshView style={styles.faceSmall} showAngles={false} />
      )}

      <View style={styles.indicators}>
        <Indicator label="Face" ok={state.faceVisible} />
        <Indicator label="Calibrated" ok={state.calibratedTop !== null} />
      </View>

      {state.phase === 'starting' ? (
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      ) : (
        <>
          {state.phase === 'active' && state.count === 0 ? (
            <Button title="Redo calibration" kind="secondary" onPress={recalibrate} />
          ) : null}
          <Button title={battle ? 'Finish attempt' : 'End set'} kind="danger" onPress={end} />
        </>
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
  battleClock: { color: colors.accent, fontSize: 28, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  count: { color: colors.text, fontSize: 130, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.muted, fontSize: 18, marginTop: -10, textTransform: 'uppercase', letterSpacing: 2 },
  badge: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, alignItems: 'center' },
  badgeText: { color: '#111', fontSize: 20, fontWeight: '800' },
  badgeSub: { color: '#111', fontSize: 13, marginTop: 2 },
  chartTitle: { color: colors.muted, fontSize: 13 },
  liveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  segment: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 2 },
  segmentItem: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 8 },
  segmentItemOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  segmentTextOn: { color: '#111' },
  faceSmall: { height: 170, borderRadius: 16, overflow: 'hidden' },
  faceBox: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#05070D', minHeight: 260 },
  lockedOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  lockedLabel: { color: colors.quality.full, fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  lockedValue: { color: colors.text, fontSize: 56, fontWeight: '900', fontVariant: ['tabular-nums'] },
  lockedSub: { color: colors.muted, fontSize: 16 },
  indicators: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  indicator: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  indicatorText: { color: colors.muted, fontSize: 14 },
  unavailableTitle: { color: colors.text, fontSize: 26, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  unavailableText: { color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
});
