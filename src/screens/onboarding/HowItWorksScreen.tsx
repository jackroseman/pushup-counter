import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { Button, Card, Icon, type IconName, Text } from '../../ui';
import { color, gutter } from '../../ui/tokens';
import { OnboardingBar } from './OnboardingBar';

const STEPS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'phone', title: 'Put your phone on the floor', detail: 'Screen up, under your chest.' },
  { icon: 'face', title: 'Get into position', detail: 'Look down at the phone. It counts each rep you do.' },
  { icon: 'speaker', title: 'Listen for the count', detail: 'Reps are counted out loud, so you never need to look.' },
];

/** Frame 3: step 3 of 3 on first run; also opened from Today's "How it works" (no dots). */
export function HowItWorksScreen({
  step,
  onBack,
  onTry,
  onLater,
  canTry,
}: {
  step: number | null;
  onBack: () => void;
  onTry: () => void;
  onLater: () => void;
  /** False on iPhones without a Face ID camera. */
  canTry: boolean;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.pad}>
        <OnboardingBar step={step} onBack={onBack} />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
        <Text variant="title1" accessibilityRole="header" style={styles.title}>
          How it works
        </Text>
        {STEPS.map((s, i) => (
          <View key={s.title} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}. ${s.title}. ${s.detail}`}>
            <View style={styles.tile}>
              <Icon name={s.icon} size={26} />
            </View>
            <View style={styles.grow}>
              <Text variant="caption" weight="600">
                {`STEP ${i + 1}`}
              </Text>
              <Text variant="headline" style={styles.gap}>
                {s.title}
              </Text>
              <Text variant="subhead" style={styles.gap}>
                {s.detail}
              </Text>
            </View>
          </View>
        ))}
        <Card padding={0} style={styles.art}>
          <Svg width={300} height={130} viewBox="0 0 300 130" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Line x1={10} y1={120} x2={290} y2={120} stroke={color.tertiary} strokeWidth={1.5} />
            <Rect x={128} y={113} width={44} height={7} rx={2} fill={color.label} />
            <Path d="M60 98 L150 82 L250 96" stroke={color.label} strokeWidth={3} fill="none" strokeLinecap="round" />
            <Circle cx={150} cy={70} r={11} stroke={color.label} strokeWidth={3} fill="none" />
            <Path d="M95 92 L92 120 M215 92 L222 120" stroke={color.label} strokeWidth={3} strokeLinecap="round" />
          </Svg>
        </Card>
      </ScrollView>
      <View style={[styles.pad, styles.footer]}>
        {canTry ? <Button title="Try a set" onPress={onTry} /> : null}
        <Button title="Maybe later" kind="plain" onPress={onLater} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pad: { paddingHorizontal: gutter },
  title: { marginTop: 14 },
  step: { flexDirection: 'row', gap: 16, marginTop: 26, alignItems: 'flex-start' },
  tile: { width: 52, height: 52, borderRadius: 14, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  gap: { marginTop: 2 },
  art: { marginTop: 30, height: 150, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  footer: { paddingTop: 8, paddingBottom: 6 },
});
