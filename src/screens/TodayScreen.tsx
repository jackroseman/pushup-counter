import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { HowToSheet } from '../components/HowToSheet';
import { Ring } from '../components/Ring';
import { SignInCard } from '../components/SignInCard';
import { TodayModel, WeekCardModel, weekCardLine } from '../progress';
import { colors } from '../theme';

export function TodayScreen({
  view,
  depth,
  howToOpen,
  banner,
  week,
  savedSets,
  onStart,
  onGoal,
  onAccount,
  onWeek,
  onOpenHowTo,
  onCloseHowTo,
}: {
  view: TodayModel;
  depth: boolean;
  howToOpen: boolean;
  banner?: string | null;
  week?: WeekCardModel | null;
  onWeek?: () => void;
  savedSets: number;
  onStart: () => void;
  onGoal: () => void;
  onAccount: () => void;
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

      {week && onWeek ? (
        <Pressable accessibilityRole="button" onPress={onWeek} style={styles.week}>
          <Text style={styles.weekTitle}>{week.title}</Text>
          <Text style={styles.weekLine}>{weekCardLine(week)}</Text>
          {week.ranks ? <Text style={styles.weekRanks}>{week.ranks}</Text> : null}
        </Pressable>
      ) : null}

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
  week: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginTop: 8, marginBottom: 8 },
  weekTitle: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  weekLine: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 4 },
  weekRanks: { color: colors.muted, fontSize: 15, marginTop: 4 },
  warn: { color: colors.danger, fontSize: 15, lineHeight: 21, marginTop: 12 },
  textButton: { alignItems: 'center', paddingVertical: 12 },
  textButtonLabel: { color: colors.accent, fontSize: 16, fontWeight: '700' },
});
