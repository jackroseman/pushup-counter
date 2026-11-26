import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton, Text } from '../../ui';
import { color } from '../../ui/tokens';

/** Back button, step dots (the current one wide) and an optional Skip (frames 2 and 3). */
export function OnboardingBar({
  step,
  steps = 3,
  onBack,
  onSkip,
}: {
  /** 1-based; null hides the dots (How it works opened from Today). */
  step: number | null;
  steps?: number;
  onBack: () => void;
  onSkip?: () => void;
}) {
  return (
    <View style={styles.bar}>
      <IconButton icon="back" accessibilityLabel="Back" onPress={onBack} />
      {step != null ? (
        <View style={styles.dots} accessible accessibilityLabel={`Step ${step} of ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <View key={i} style={[styles.dot, i + 1 === step && styles.current, i + 1 > step && styles.later]} />
          ))}
        </View>
      ) : null}
      <View style={styles.side}>
        {onSkip ? (
          <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={10}>
            <Text variant="body" tone="secondary" align="right">
              Skip
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.label },
  current: { width: 20 },
  later: { backgroundColor: color.graphite },
  side: { width: 36, alignItems: 'flex-end' },
});
