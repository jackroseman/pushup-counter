import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { Settings } from '../storage/settings';
import { colors } from '../theme';
import { faceTrackingSupported } from '../sensors';

const STEPS = [
  'Turn the volume up. Reps are spoken out loud because the screen turns off while your chest covers the phone.',
  'Place the iPhone face-up on the floor, screen toward you, under your upper chest.',
  'Get in the top position (arms straight) with your face over the phone.',
  'Tap Start. Hold still for the short calibration countdown, then go.',
  'Each time your chest touches the phone and rises again, that is one rep.',
];

export function StartScreen({
  settings,
  onChangeSettings,
  onStart,
  onHistory,
}: {
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onStart: () => void;
  onHistory: () => void;
}) {
  const depth = faceTrackingSupported();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Pushup Counter</Text>
      <Text style={styles.subtitle}>Chest-to-phone rep counting with depth scoring</Text>

      <View style={styles.card}>
        {STEPS.map((s, i) => (
          <View key={i} style={styles.step}>
            <Text style={styles.stepNum}>{i + 1}</Text>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.note}>
          {depth
            ? 'Depth scoring: TrueDepth camera available ✓'
            : 'Depth scoring unavailable on this device. Reps are still counted with the proximity sensor.'}
        </Text>
        <Row
          label="Count reps by depth alone"
          hint="Counts reps that get low enough even when your chest doesn't touch the phone."
          value={settings.depthOnlyCounting}
          onChange={(v) => onChangeSettings({ ...settings, depthOnlyCounting: v })}
          disabled={!depth}
        />
        <Row
          label="Speak rep quality"
          hint='Says "7, shallow" for reps that aren’t full depth.'
          value={settings.speakQuality}
          onChange={(v) => onChangeSettings({ ...settings, speakQuality: v })}
        />
        <Row label="Haptics" value={settings.haptics} onChange={(v) => onChangeSettings({ ...settings, haptics: v })} />
      </View>

      <Button title="Start" onPress={onStart} />
      <Button title="History" kind="secondary" onPress={onHistory} />
    </ScrollView>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[styles.rowLabel, disabled && { color: colors.muted }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch value={value && !disabled} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 12 },
  subtitle: { color: colors.muted, fontSize: 16, marginTop: 4, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  step: { flexDirection: 'row', marginBottom: 10 },
  stepNum: { color: colors.accent, fontWeight: '800', fontSize: 16, width: 22 },
  stepText: { color: colors.text, fontSize: 15, flex: 1, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowHint: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
