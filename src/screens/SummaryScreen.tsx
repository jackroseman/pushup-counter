import React from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import type { TodayCard } from '../progress/summaryModel';
import { formSplit, setClock, setSeconds, summaryBadge } from '../progress/summaryModel';
import type { Celebration } from '../progress';
import { SessionRecord } from '../storage/history';
import { Button, Card, FadeIn, FormSplitBar, IconButton, Pill, ProgressBar, Text, color, gutter, motion } from '../ui';

/** Today's progress under the count (frame 11 / E4). */
function TodayProgress({ card }: { card: TodayCard }) {
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <Text variant="headline">Today</Text>
        <Text variant="subhead">
          <Text variant="subhead" tone="label" weight="700">
            {String(card.reps)}
          </Text>
          {card.target != null ? ` of ${card.target}` : ' reps'}
        </Text>
      </View>
      {card.progress != null ? (
        <ProgressBar
          progress={card.progress}
          fill={card.done ? color.signal : color.label}
          track={card.done ? color.fill.signalSoft : color.graphite}
          style={styles.bar}
        />
      ) : null}
      {card.line ? (
        <Text variant="footnote" tone={card.done ? 'signal' : 'secondary'} style={styles.line}>
          {card.line}
        </Text>
      ) : null}
    </Card>
  );
}

/** Just-finished set (frame 11, E4): the count first, a quiet badge, today's progress and the depth split; Done, then quiet Challenge a friend and Set details. */
export function SummaryScreen({
  record,
  today,
  celebration,
  onDone,
  onDetails,
  onChallenge,
}: {
  record: SessionRecord;
  /** Null until today's numbers are loaded. */
  today: TodayCard | null;
  celebration: Celebration | null;
  onDone: () => void;
  onDetails: () => void;
  /** "Challenge a friend" under Done; omitted for a set with no reps. */
  onChallenge?: () => void;
}) {
  const reps = record.reps.length;
  const badge = summaryBadge(celebration);
  const share = () => {
    Share.share({ message: `${reps} push-ups in one set.` }).catch(() => {});
  };
  return (
    <View style={styles.container}>
      <View style={styles.bar44}>
        <IconButton icon="share" onPress={share} accessibilityLabel="Share" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {badge ? (
            <FadeIn delay={motion.roll} style={styles.badge}>
              <Pill label={badge.label} icon={badge.icon} tone="inverse" size="large" />
            </FadeIn>
          ) : null}
          <Text variant="hero" size={150} style={styles.count} accessibilityLabel={`${reps} reps`}>
            {String(reps)}
          </Text>
          <Text variant="subhead" style={styles.meta}>
            reps · {setClock(setSeconds(record))}
          </Text>
        </View>
        {today ? <TodayProgress card={today} /> : null}
        {reps > 0 ? (
          <Card style={[styles.card, styles.split]}>
            <FormSplitBar split={formSplit(record.reps)} />
          </Card>
        ) : null}
      </ScrollView>
      <Button title="Done" onPress={onDone} />
      {onChallenge ? <Button title="Challenge a friend" kind="plain" onPress={onChallenge} /> : null}
      <Button title="Set details" kind="plain" onPress={onDetails} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: gutter, paddingBottom: 14, backgroundColor: color.bg },
  bar44: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  scroll: { flexGrow: 1, paddingBottom: 16 },
  hero: { alignItems: 'center', marginTop: 26 },
  badge: { marginBottom: 22 },
  count: {},
  meta: { marginTop: 6, fontSize: 17, lineHeight: 22 },
  card: { marginTop: 34 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bar: { marginTop: 12 },
  line: { marginTop: 8 },
  split: { marginTop: 10, paddingVertical: 14 },
});
