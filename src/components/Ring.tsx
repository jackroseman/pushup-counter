import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';

const SIZE = 196;
const STROKE = 14;

/** Today's ring. `progress` is 0–1, or null when there is no fraction to fill. */
export function Ring({
  text,
  caption,
  progress,
  onPress,
}: {
  text: string;
  caption: string;
  progress: number | null;
  onPress: () => void;
}) {
  const r = (SIZE - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const filled = progress == null ? 0 : c * Math.max(0, Math.min(1, progress));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. ${caption}`.trim()} onPress={onPress} style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke="#2A3145" strokeWidth={STROKE} fill="none" />
        {filled > 0 ? (
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            stroke={colors.accent}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${filled} ${c - filled}`}
            strokeLinecap="round"
            rotation={-90}
            origin={`${SIZE / 2}, ${SIZE / 2}`}
          />
        ) : null}
      </Svg>
      <View style={styles.label} pointerEvents="none">
        <Text style={styles.text} numberOfLines={2} adjustsFontSizeToFit>
          {text}
        </Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignSelf: 'center', marginVertical: 8 },
  label: { position: 'absolute', left: 28, right: 28, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  caption: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 4 },
});
