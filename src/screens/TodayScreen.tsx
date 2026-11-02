import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { HowToSheet } from '../components/HowToSheet';
import { Ring } from '../components/Ring';
import { SignInCard } from '../components/SignInCard';
import { TodayModel } from '../progress';
import { colors } from '../theme';

export function TodayScreen({
  view,
  depth,
  showBattles,
  howToOpen,
  banner,
  savedSets,
  onStart,
  onGoal,
  onProgress,
  onLeague,
  onAccount,
  onBattles,
  onOpenHowTo,
  onCloseHowTo,
}: {
  view: TodayModel;
  depth: boolean;
  showBattles: boolean;
  howToOpen: boolean;
  banner?: string | null;
  savedSets: number;
  onStart: () => void;
  onGoal: () => void;
  onProgress: () => void;
  onLeague: () => void;
  onAccount: () => void;
  onBattles: () => void;
  onOpenHowTo: () => void;
  onCloseHowTo: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Today</Text>
        <Pressable accessibilityRole="button" onPress={onAccount} hitSlop={8}>
          <Text style={styles.account}>Account</Text>
        </Pressable>
      </View>
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}

      <View style={styles.hero}>
        <Ring text={view.ringText} caption={view.ringCaption} progress={view.ringProgress} onPress={onGoal} />
        <Text style={styles.streak}>{view.streakLine}</Text>
        {view.usualLine ? <Text style={styles.usual}>{view.usualLine}</Text> : null}
        {view.travelLine ? <Text style={styles.note}>{view.travelLine}</Text> : null}
      </View>

      {!depth ? (
        <Text style={styles.warn}>
          This iPhone has no TrueDepth (Face ID) camera. Rep Royale measures your depth with it to count reps, so it can't count on this device.
        </Text>
      ) : (
        <Button title="Do a set" onPress={onStart} />
      )}
      {view.showSetGoal ? (
        <Pressable accessibilityRole="button" onPress={onGoal} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Set a goal</Text>
        </Pressable>
      ) : null}
      {showBattles ? <Button title="Battles" kind="secondary" onPress={onBattles} /> : null}
      <Button title="Progress" kind="secondary" onPress={onProgress} />
      <Button title="League" kind="secondary" onPress={onLeague} />
      <Pressable accessibilityRole="button" onPress={onOpenHowTo} style={styles.textButton}>
        <Text style={styles.textButtonLabel}>How counting works</Text>
      </Pressable>
      <SignInCard savedSets={savedSets} />
      <HowToSheet visible={howToOpen} onClose={onCloseHowTo} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800' },
  account: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  banner: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 12 },
  hero: { alignItems: 'center', marginBottom: 8 },
  streak: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 4 },
  usual: { color: colors.muted, fontSize: 16, marginTop: 6, textAlign: 'center' },
  note: { color: colors.muted, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  warn: { color: colors.danger, fontSize: 15, lineHeight: 21, marginTop: 12 },
  textButton: { alignItems: 'center', paddingVertical: 12 },
  textButtonLabel: { color: colors.accent, fontSize: 16, fontWeight: '700' },
});
