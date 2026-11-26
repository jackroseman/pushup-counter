import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../ui';
import { CUSTOM_GOAL } from '../../progress';

/** "Set my own number": one daily number, in steps of 5. No mockup frame; built from the tokens. */
export function CustomGoal({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Button
          title="−"
          kind="tinted"
          size="small"
          accessibilityLabel="Lower the daily goal"
          disabled={value <= CUSTOM_GOAL.min}
          onPress={() => onChange(Math.max(CUSTOM_GOAL.min, value - CUSTOM_GOAL.step))}
        />
        <Text variant="hero" size={72} align="center" style={styles.value} accessibilityLabel={`${value} a day`}>
          {String(value)}
        </Text>
        <Button
          title="+"
          kind="tinted"
          size="small"
          accessibilityLabel="Raise the daily goal"
          disabled={value >= CUSTOM_GOAL.max}
          onPress={() => onChange(Math.min(CUSTOM_GOAL.max, value + CUSTOM_GOAL.step))}
        />
      </View>
      <Text variant="subhead" align="center">
        push-ups a day
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  value: { minWidth: 140 },
});
