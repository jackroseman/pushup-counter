import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import type { RepQuality } from '../core';
import { Icon, IconName } from './Icon';
import { color, radius } from './tokens';

export type PillTone = 'neutral' | 'signal' | 'inverse' | 'graphite';

const TONE: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: color.fill.pill, fg: color.label },
  signal: { bg: color.fill.signalSoft, fg: color.signal },
  /** White pill with black text ("New best set"). */
  inverse: { bg: color.label, fg: color.bg },
  graphite: { bg: color.graphite, fg: color.label },
};

const SIZE = {
  small: { height: 22, fontSize: 11, icon: 10 },
  regular: { height: 26, fontSize: 13, icon: 12 },
  large: { height: 30, fontSize: 14, icon: 13 },
  /** Streak chip on Today. */
  chip: { height: 32, fontSize: 15, icon: 15 },
} as const;

export type PillSize = keyof typeof SIZE;

/** Capsule label ("Best", "Flat", "Centered", "Full"). */
export function Pill({
  label,
  tone = 'neutral',
  size = 'regular',
  icon,
  style,
}: {
  label: string;
  tone?: PillTone;
  size?: PillSize;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const t = TONE[tone];
  const s = SIZE[size];
  return (
    <View style={[styles.pill, { height: s.height, backgroundColor: t.bg }, style]}>
      {icon ? <Icon name={icon} size={s.icon} color={t.fg} /> : null}
      <Text style={[styles.text, { fontSize: s.fontSize, color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export const QUALITY_LABEL: Record<RepQuality, string> = { full: 'Full', good: 'Good', shallow: 'Too shallow' };
const QUALITY_TONE: Record<RepQuality, PillTone> = { full: 'signal', good: 'neutral', shallow: 'graphite' };

/** The last rep's depth while counting: Full (green), Good (white), Too shallow (graphite). */
export function QualityPill({ quality, style }: { quality: RepQuality; style?: StyleProp<ViewStyle> }) {
  return <Pill label={QUALITY_LABEL[quality]} tone={QUALITY_TONE[quality]} size="regular" style={[styles.quality, style]} />;
}

/** Streak count with a flame, top right of Today. Hidden by the caller when there's no streak. */
export function StreakChip({ days, style }: { days: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessible accessibilityLabel={`${days}-day streak`} style={style}>
      <Pill label={String(days)} icon="flame" size="chip" />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 5, paddingHorizontal: 10, borderRadius: radius.capsule },
  text: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  quality: { height: 28 },
});
