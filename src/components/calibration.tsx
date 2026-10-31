import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { CheckState, GuideSnapshot } from '../core';
import { colors } from '../theme';

/** Ring that fills while the user holds steady (0..1). */
export function ProgressRing({
  progress,
  size = 76,
  stroke = 8,
  color = colors.quality.full,
  label,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#2A3145" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringText}>{label ?? `${Math.round(p * 100)}%`}</Text>
    </View>
  );
}

function Check({ label, state, detail }: { label: string; state: CheckState; detail?: string }) {
  const color = state === 'ok' ? colors.quality.full : state === 'bad' ? colors.danger : colors.muted;
  const mark = state === 'ok' ? '✓' : state === 'bad' ? '✗' : '–';
  return (
    <View style={styles.check}>
      <Text style={[styles.checkMark, { color }]}>{mark}</Text>
      <Text style={styles.checkLabel}>{label}</Text>
      {detail ? <Text style={styles.checkDetail}>{detail}</Text> : null}
    </View>
  );
}

/** Live calibration guidance: what to fix, the four pose checks, and the hold-still ring. */
export function CalibrationPanel({ guide }: { guide: GuideSnapshot | null }) {
  if (!guide) return null;
  const { pose, progress } = guide;
  const steady: CheckState = progress > 0 ? 'ok' : pose.ok ? 'bad' : 'unknown';
  const resetting = guide.lastReset !== null && progress < 0.25 && pose.ok;
  return (
    <View style={styles.panel}>
      <ProgressRing
        progress={progress}
        color={resetting ? colors.accent : colors.quality.full}
        label={pose.ok ? `${Math.round(progress * 100)}%` : '–'}
      />
      <View style={styles.panelRight}>
        <Text style={[styles.message, pose.ok ? null : styles.messageBad]} numberOfLines={2}>
          {guide.message}
        </Text>
        <View style={styles.checks}>
          <Check label="Face" state={pose.face} />
          <Check
            label="Distance"
            state={pose.distance}
            detail={pose.distanceM !== null ? `${Math.round(pose.distanceM * 100)} cm` : undefined}
          />
          <Check
            label="Centered"
            state={pose.centered}
            detail={pose.offsetDeg !== null ? `${Math.round(pose.offsetDeg)}°` : undefined}
          />
          <Check label="Head angle" state={pose.angle} />
          <Check label="Steady" state={steady} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ringText: { color: colors.text, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  panel: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 12, marginTop: 10 },
  panelRight: { flex: 1, marginLeft: 12 },
  message: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  messageBad: { color: colors.accent },
  checks: { flexDirection: 'row', flexWrap: 'wrap' },
  check: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
  checkMark: { fontSize: 14, fontWeight: '900', marginRight: 3 },
  checkLabel: { color: colors.muted, fontSize: 13 },
  checkDetail: { color: colors.text, fontSize: 13, marginLeft: 3, fontVariant: ['tabular-nums'] },
});
