import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar, AvatarStack, Button, Card, Icon, Ring, RollingNumber, StreakChip, TabHeader, Text, WeekStrip } from '../ui';
import { color, gutter, radius } from '../ui/tokens';
import { todayActionRows, type OpenChallenge } from '../battles/openChallenges';
import { YourTurnList } from './compete/YourTurnList';
import { heroLabel, type TodayChallengeCard, type TodayHero, type TodayView } from '../ui/models/today';

/** A ring at 0 still shows its start as a dot (E1, E3). */
const RING_START = 0.0001;

export function TodayScreen({
  view,
  date,
  banner,
  note,
  depth,
  onStart,
  onGoal,
  onLeague,
  onChallenge,
  onPlay,
  onNewChallenge,
  onInvite,
  onHowItWorks,
  onSeeAll,
  openRows,
  optInBanner,
  active = true,
}: {
  view: TodayView;
  /** "Wednesday, November 25". */
  date: string;
  banner?: string | null;
  /** Rare one-line note under the ring (time-zone change). */
  note?: string | null;
  /** False on iPhones without a Face ID camera: no Start button. */
  depth: boolean;
  onStart: () => void;
  onGoal: () => void;
  onLeague: () => void;
  onChallenge: (battleId: string) => void;
  onPlay: (battleId: string) => void;
  onNewChallenge: () => void;
  onInvite: () => void;
  onHowItWorks: () => void;
  onSeeAll?: () => void;
  openRows?: OpenChallenge[] | null;
  /** Soft-nudge to turn on notifications, after Not now or an iOS denial. */
  optInBanner?: React.ReactNode;
  /** False while Today is behind another screen: the ring and count wait to animate until it is back. */
  active?: boolean;
}) {
  // Keep showing the last hero while Today is hidden, so the fill and roll play once it is visible.
  const [seen, setSeen] = useState(view.hero);
  if (active && seen !== view.hero) setSeen(view.hero);
  const hero = active ? view.hero : seen;
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <TabHeader title="Today" subtitle={date} right={view.streak != null ? <StreakChip days={view.streak} /> : null} />
      {banner ? (
        <Text variant="footnote" style={styles.banner}>
          {banner}
        </Text>
      ) : null}

      <Hero hero={hero} onGoal={onGoal} />
      {view.line ? (
        <Text
          variant="subhead"
          align="center"
          tone={view.line.tone}
          weight={view.line.tone === 'signal' ? '600' : undefined}
          style={styles.line}
        >
          {view.line.text}
        </Text>
      ) : null}
      {note ? (
        <Text variant="footnote" align="center" style={styles.note}>
          {note}
        </Text>
      ) : null}

      {depth ? (
        <Button
          title={view.primary.title}
          kind={view.primary.kind}
          icon="play"
          onPress={onStart}
          style={view.hero.kind === 'count' ? styles.startAfterCount : styles.start}
        />
      ) : (
        <Text variant="subhead" align="center" style={styles.start}>
          This iPhone can't count reps. It needs a Face ID camera.
        </Text>
      )}

      {optInBanner ? <View style={styles.optIn}>{optInBanner}</View> : null}

      {view.league ? (
        <Card padding={0} onPress={onLeague} style={styles.firstCard} accessibilityLabel={`${view.league.title}. ${view.league.detail}`}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text variant="footnote" weight="500">
                {view.league.label}
              </Text>
              <Text variant="headline" style={styles.cardTitle}>
                {view.league.title}
              </Text>
              {view.league.detail ? <Text variant="footnote">{view.league.detail}</Text> : null}
            </View>
            <AvatarStack people={view.league.people} />
            <Icon name="chev" size={13} color={color.tertiary} />
          </View>
        </Card>
      ) : null}

      {(() => {
        const today = todayActionRows(openRows ?? []);
        if (today.rows.length > 0) {
          return (
            <YourTurnList
              rows={openRows ?? []}
              cap={3}
              seeAll={today.seeAll}
              showWaiting={false}
              onOpen={onChallenge}
              onSeeAll={onSeeAll}
            />
          );
        }
        if (view.challenge) {
          return (
            <ChallengeRow
              card={view.challenge}
              first={!view.league}
              onChallenge={onChallenge}
              onPlay={onPlay}
              onNewChallenge={onNewChallenge}
            />
          );
        }
        return null;
      })()}

      {view.betterWithFriends ? (
        <Card padding={0} style={view.league || view.challenge ? styles.card : styles.firstCard}>
          <View style={[styles.row, styles.rowRoomy]}>
            <View style={[styles.circle, styles.circleLarge]}>
              <Icon name="people" size={20} />
            </View>
            <View style={styles.grow}>
              <Text variant="headline" style={styles.small}>
                Better with friends
              </Text>
              <Text variant="footnote">A weekly league and head-to-head challenges.</Text>
            </View>
            <Button title="Invite" kind="tinted" size="small" onPress={onInvite} />
          </View>
        </Card>
      ) : null}

      {view.howItWorks ? (
        <Card padding={0} onPress={onHowItWorks} style={styles.card} accessibilityLabel="How it works">
          <View style={styles.row}>
            <View style={styles.tile}>
              <Icon name="info" size={16} />
            </View>
            <Text variant="body" style={[styles.grow, styles.small]}>
              How it works
            </Text>
            <Icon name="chev" size={13} color={color.tertiary} />
          </View>
        </Card>
      ) : null}

      {view.week ? <WeekStrip days={view.week} style={styles.card} /> : null}
    </ScrollView>
  );
}

function Hero({ hero, onGoal }: { hero: TodayHero; onGoal: () => void }) {
  if (hero.kind === 'count') {
    return (
      <View style={styles.count} accessible accessibilityLabel={heroLabel(hero)}>
        <RollingNumber
          value={hero.reps}
          distance={14}
          render={(n) => (
            <Text variant="hero" size={104} tone={n === 0 ? 'secondary' : 'label'}>
              {String(n)}
            </Text>
          )}
        />
        <Text variant="subhead" style={styles.countCaption}>
          push-ups today
        </Text>
        <Pressable accessibilityRole="button" onPress={onGoal} style={({ pressed }) => [styles.goalPill, pressed && styles.pressed]}>
          <Text variant="subhead" weight="600" tone="label">
            Set a daily goal
          </Text>
          <Icon name="chev" size={13} color={color.tertiary} />
        </Pressable>
      </View>
    );
  }
  const ring = hero.kind === 'ring';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={heroLabel(hero)}
      accessibilityHint="Opens your daily goal"
      onPress={onGoal}
      style={styles.ringWrap}
    >
      <Ring progress={ring ? Math.max(RING_START, hero.progress) : 0} done={ring && hero.done}>
        <RollingNumber
          value={hero.reps}
          distance={11}
          render={(n) => (
            <Text variant="hero" size={84} tone={n === 0 ? 'secondary' : 'label'}>
              {String(n)}
            </Text>
          )}
        />
        <Text variant="subhead" style={styles.ringCaption}>
          {ring ? `of ${hero.target} today` : 'Rest day'}
        </Text>
      </Ring>
    </Pressable>
  );
}

function ChallengeRow({
  card,
  first,
  onChallenge,
  onPlay,
  onNewChallenge,
}: {
  card: TodayChallengeCard;
  first: boolean;
  onChallenge: (battleId: string) => void;
  onPlay: (battleId: string) => void;
  onNewChallenge: () => void;
}) {
  const style = first ? styles.firstCard : styles.card;
  if (card.kind === 'challenge_friend') {
    return (
      <Card padding={0} style={style}>
        <View style={styles.row}>
          <View style={styles.circle}>
            <Icon name="bolt" size={18} />
          </View>
          <View style={styles.grow}>
            <Text variant="headline" style={styles.small}>
              {card.title}
            </Text>
            <Text variant="footnote">{card.detail}</Text>
          </View>
          <Button title="New" kind="tinted" size="small" onPress={onNewChallenge} accessibilityLabel="New challenge" />
        </View>
      </Card>
    );
  }
  const play = card.kind === 'your_move';
  return (
    <Card padding={0} style={style} onPress={() => onChallenge(card.battleId)} accessibilityLabel={`${card.title}. ${card.detail}`}>
      <View style={styles.row}>
        <Avatar name={card.opponent} size={36} />
        <View style={styles.grow}>
          <Text variant="headline" style={styles.small}>
            {card.title}
          </Text>
          <Text variant="footnote">{card.detail}</Text>
        </View>
        <Button
          title={play ? 'Play' : 'View'}
          kind="tinted"
          size="small"
          onPress={() => (play ? onPlay(card.battleId) : onChallenge(card.battleId))}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: 32 },
  banner: { marginTop: 8 },
  ringWrap: { alignSelf: 'center', marginTop: 16 },
  ringCaption: { marginTop: 6 },
  count: { alignItems: 'center', marginTop: 46 },
  countCaption: { marginTop: 8, fontSize: 17, lineHeight: 22 },
  goalPill: {
    marginTop: 14,
    height: 30,
    paddingHorizontal: 14,
    borderRadius: radius.capsule,
    backgroundColor: color.fill.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pressed: { opacity: 0.7 },
  line: { marginTop: 12 },
  note: { marginTop: 6 },
  start: { marginTop: 18 },
  startAfterCount: { marginTop: 34 },
  optIn: { marginTop: 12 },
  firstCard: { marginTop: 12 },
  card: { marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  rowRoomy: { paddingVertical: 14, paddingHorizontal: 14 },
  grow: { flex: 1, minWidth: 0 },
  cardTitle: { marginTop: 3 },
  small: { fontSize: 15, lineHeight: 20 },
  circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  circleLarge: { width: 40, height: 40, borderRadius: 20 },
  tile: { width: 30, height: 30, borderRadius: radius.tile, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
});
