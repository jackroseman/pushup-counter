import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { TiltSnapshot } from '../core';
import { Text, color, motionSpec, useReduceMotion, useTween } from '../ui';

/** Level size (frame 6): a 240 pt dial with a 100 pt target ring and a 32 pt bubble. */
const SIZE = 240;
// At the 8° ready tilt the bubble sits about 33 pt from center, inside the target ring.
const R = SIZE / 2;
const TARGET_R = 50;
const BUBBLE_R = 16;
/** Tilt (as sin of the angle) that puts the bubble on the outer ring. sin 30° = 0.5. */
const FULL_SCALE = 0.5;
/** Default radius for bubbleOffset (kept for the unit tests). */
const DEFAULT_R = 82;

/** Bubble position (px from center). A bubble floats to the high side, so it moves against gravity. */
export function bubbleOffset(
  level: Pick<TiltSnapshot, 'bubbleX' | 'bubbleY' | 'screenUp'>,
  radius: number = DEFAULT_R,
  bubble = 12
): { dx: number; dy: number } {
  if (!level.screenUp) return { dx: 0, dy: -radius };
  let dx = (-level.bubbleX / FULL_SCALE) * radius;
  // Device +y is toward the top of the screen; SVG +y is down.
  let dy = (level.bubbleY / FULL_SCALE) * radius;
  const len = Math.hypot(dx, dy);
  const max = radius - bubble;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  return { dx, dy };
}

/** How far the green target ring starts outside its final size when the level locks (pt). */
export const LOCK_SETTLE = 8;

/**
 * "Lay your phone flat" (frame 6): the level and the title. When the phone goes flat the target
 * ring and the bubble fade to green and the green ring settles in from slightly larger (250 ms,
 * ease-out, no bounce). Reduce Motion: the same color crossfade, without the settle.
 */
export function LevelView({ level }: { level: TiltSnapshot | null }) {
  const known = !!level && level.tiltDeg !== null;
  const flat = known && level!.flat;
  const { dx, dy } = known ? bubbleOffset(level!, R, BUBBLE_R) : { dx: 0, dy: 0 };
  const reduced = useReduceMotion();
  const lock = useTween(flat ? 1 : 0, 'lock', reduced, flat ? 1 : 0);
  const settle = motionSpec('lock', reduced).move ? (1 - lock) * LOCK_SETTLE : 0;
  const c = SIZE / 2;
  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Circle cx={c} cy={c} r={R - 0.75} fill="none" stroke={color.graphite} strokeWidth={1.5} />
        <Line x1={c} y1={0} x2={c} y2={SIZE} stroke={color.graphite} strokeWidth={1} />
        <Line x1={0} y1={c} x2={SIZE} y2={c} stroke={color.graphite} strokeWidth={1} />
        <Circle cx={c} cy={c} r={TARGET_R - 1} fill="none" stroke={color.tertiary} strokeWidth={2} opacity={1 - lock} />
        <Circle cx={c} cy={c} r={TARGET_R - 1 + settle} fill="none" stroke={color.signal} strokeWidth={2} opacity={lock} />
        {known ? <Circle cx={c + dx} cy={c + dy} r={BUBBLE_R} fill={color.label} /> : null}
        {known ? <Circle cx={c + dx} cy={c + dy} r={BUBBLE_R} fill={color.signal} opacity={lock} /> : null}
      </Svg>
      <Text variant="title2" align="center" style={styles.title}>
        Lay your phone flat
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  title: { marginTop: 44 },
});
