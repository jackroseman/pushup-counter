import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { CheckState, DEFAULT_TILT_OPTIONS, TiltSnapshot } from '../core';
import { colors } from '../theme';
import { color } from '../ui/tokens';
import { ProgressRing } from './calibration';

const SIZE = 190;
const R = 82;
/** Tilt (as sin of the angle) that puts the bubble on the outer ring. sin 30° = 0.5. */
const FULL_SCALE = 0.5;
const TARGET_R = R * (Math.sin((DEFAULT_TILT_OPTIONS.readyMaxDeg * Math.PI) / 180) / FULL_SCALE);

/** Bubble position (px from center). A bubble floats to the high side, so it moves against gravity. */
export function bubbleOffset(level: Pick<TiltSnapshot, 'bubbleX' | 'bubbleY' | 'screenUp'>): { dx: number; dy: number } {
  if (!level.screenUp) return { dx: 0, dy: -R };
  let dx = (-level.bubbleX / FULL_SCALE) * R;
  // Device +y is toward the top of the screen; SVG +y is down.
  let dy = (level.bubbleY / FULL_SCALE) * R;
  const len = Math.hypot(dx, dy);
  const max = R - 12;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  return { dx, dy };
}

/** Plain hint under the level. */
export function levelHint(level: TiltSnapshot | null): string {
  if (!level || level.tiltDeg === null) return 'Checking your phone…';
  if (!level.screenUp) return 'Turn the screen up';
  if (!level.flat) return 'Tilt closer to center';
  return 'Hold still…';
}

function Check({ label, state }: { label: string; state: CheckState }) {
  const color = state === 'ok' ? colors.quality.full : state === 'bad' ? colors.danger : colors.muted;
  const mark = state === 'ok' ? '✓' : state === 'bad' ? '✗' : '–';
  return (
    <View style={styles.check}>
      <Text style={[styles.checkMark, { color }]}>{mark}</Text>
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  );
}

/** Live level shown while placing the phone (mockup 01). */
export function LevelCard({ level }: { level: TiltSnapshot | null }) {
  const known = !!level && level.tiltDeg !== null;
  const ok = known && level!.flat;
  const { dx, dy } = known ? bubbleOffset(level!) : { dx: 0, dy: 0 };
  const color = ok ? colors.quality.full : colors.accent;
  const c = SIZE / 2;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Level your phone</Text>
      <Text style={styles.sub}>Set it flat on the floor with the screen facing up.</Text>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={c} cy={c} r={R} fill={colors.bg} stroke="#2A3145" strokeWidth={2} />
        <Circle cx={c} cy={c} r={R * 0.66} fill="none" stroke="#2A3145" strokeWidth={1} strokeDasharray="4,4" />
        <Line x1={c} y1={c - R} x2={c} y2={c + R} stroke="#1E2538" strokeWidth={1} />
        <Line x1={c - R} y1={c} x2={c + R} y2={c} stroke="#1E2538" strokeWidth={1} />
        <Circle cx={c} cy={c} r={Math.max(18, TARGET_R)} fill="rgba(48, 209, 88, 0.08)" stroke={colors.quality.full} strokeWidth={2} />
        {known ? (
          <>
            <Circle cx={c + dx} cy={c + dy} r={14} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={2.5} />
            <Circle cx={c + dx} cy={c + dy} r={5} fill={color} />
          </>
        ) : null}
      </Svg>
      <Text style={[styles.deg, { color }]}>{known ? `${Math.round(level!.tiltDeg!)}°` : '–'}</Text>
      <Text style={styles.hint}>{levelHint(level)}</Text>
    </View>
  );
}

/** Ring + checks under the level (same layout as the calibration panel). */
export function LevelPanel({ level, message }: { level: TiltSnapshot | null; message: string }) {
  const known = !!level && level.tiltDeg !== null;
  const flat: CheckState = !known ? 'unknown' : level!.flat ? 'ok' : 'bad';
  const up: CheckState = !known ? 'unknown' : level!.screenUp ? 'ok' : 'bad';
  const progress = known ? level!.readyProgress : 0;
  return (
    <View style={styles.panel}>
      <ProgressRing progress={progress} size={72} stroke={7} label={known && level!.flat ? `${Math.round(progress * 100)}%` : '–'} />
      <View style={styles.panelRight}>
        <Text style={[styles.message, known && level!.flat ? null : styles.messageBad]} numberOfLines={2}>
          {known && level!.flat ? 'Hold still…' : message}
        </Text>
        <View style={styles.checks}>
          <Check label="Flat" state={flat} />
          <Check label="Screen up" state={up} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: color.bg,
    borderColor: color.separator,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: 300,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  deg: { fontSize: 28, fontWeight: '900', marginTop: 16, fontVariant: ['tabular-nums'] },
  hint: { color: colors.muted, fontSize: 13, marginTop: 4 },
  panel: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 12, marginTop: 10 },
  panelRight: { flex: 1, marginLeft: 12 },
  message: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  messageBad: { color: colors.accent },
  checks: { flexDirection: 'row', flexWrap: 'wrap' },
  check: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 2 },
  checkMark: { fontSize: 14, fontWeight: '900', marginRight: 3 },
  checkLabel: { color: colors.muted, fontSize: 13 },
});
