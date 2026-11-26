import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, color, gutter } from '../ui';

/** Plain line shown when the phone moved and ended the set. */
export const PHONE_MOVED = 'Your phone moved.';

/** "Set ended" (frame 10): the phone moved, so the set stopped. Reps so far, then go again. */
export function SetEndedScreen({ reps, onAgain, onDone }: { reps: number; onAgain: () => void; onDone: () => void }) {
  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <View style={styles.icon}>
          <Icon name="phone" size={28} />
        </View>
        <Text variant="title1" align="center" style={styles.title} accessibilityRole="header">
          Set ended
        </Text>
        <Text variant="subhead" align="center" style={styles.sub}>
          {PHONE_MOVED}
        </Text>
        <Text variant="hero" size={96} style={styles.count} accessibilityLabel={`${reps} reps`}>
          {String(reps)}
        </Text>
        <Text variant="footnote" weight="500" style={styles.reps}>
          reps
        </Text>
      </View>
      <Button title="Start another set" onPress={onAgain} />
      <Button title="Done" kind="plain" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: gutter + 4, paddingBottom: 14, backgroundColor: color.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -20 },
  icon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
    borderColor: color.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: 24 },
  sub: { marginTop: 8, fontSize: 17, lineHeight: 22 },
  count: { marginTop: 40 },
  reps: { marginTop: 8 },
});
