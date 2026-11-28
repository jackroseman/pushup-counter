import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, Icon, IconButton, ListGroup, ListRow, Pill, ProgressBar, SectionHeader, Segmented, StatTile, TabHeader, Text, color, gutter, radius, space } from '../ui';
import { formatCount } from '../progress';
import { formatSetDateTime } from '../progress/format';
import type { YouModel, YouRecentRow } from '../progress/you';
import { recordIsEmpty, type ChallengeFriendRow, type ChallengeRecordPeriod, type MyChallengeRecord } from '../battles/openChallenges';
import { PeriodPicker } from './PeriodPicker';

export interface YouIdentity {
  name: string;
  /** `@sunny · Since October`. */
  line: string;
}

/** The user's own space (frame 14): profile, records, milestone and recent sets. Empty states E5 and E6. */
export function YouScreen({
  model,
  identity,
  signIn,
  pickUsername,
  banner,
  timeZone,
  nowMs,
  onSettings,
  onSetGoal,
  onStartSet,
  onAllSets,
  onOpenSet,
  segment = 'sets',
  onSegment,
  challengeRecord,
  onOpenChallenge,
  onOpenFriend,
  recordPeriods,
  recordPeriod,
  onRecordPeriod,
}: {
  model: YouModel;
  /** Signed in with a username. */
  identity: YouIdentity | null;
  /** Signed out and Sign in with Apple is available. */
  signIn: { onPress: () => void; message: string | null } | null;
  /** Signed in without a username yet. */
  pickUsername: (() => void) | null;
  banner?: string | null;
  timeZone: string;
  nowMs: number;
  onSettings: () => void;
  onSetGoal: () => void;
  onStartSet: () => void;
  onAllSets: () => void;
  onOpenSet: (id: string) => void;
  segment?: 'sets' | 'challenges';
  onSegment?: (key: 'sets' | 'challenges') => void;
  challengeRecord?: MyChallengeRecord | null;
  onOpenChallenge?: (id: string) => void;
  onOpenFriend?: (friend: ChallengeFriendRow) => void;
  recordPeriods?: readonly ChallengeRecordPeriod[];
  recordPeriod?: ChallengeRecordPeriod | null;
  onRecordPeriod?: (period: ChallengeRecordPeriod) => void;
}) {
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <TabHeader title="You" right={<IconButton icon="gear" accessibilityLabel="Settings" onPress={onSettings} />} />
      {banner ? (
        <Text variant="footnote" style={styles.banner}>
          {banner}
        </Text>
      ) : null}

      {identity ? (
        <View style={styles.profile} accessible accessibilityLabel={`${identity.name}, ${identity.line}`}>
          <Avatar name={identity.name} size={56} me />
          <View style={styles.grow}>
            <Text variant="title2" numberOfLines={1}>
              {identity.name}
            </Text>
            <Text variant="footnote" numberOfLines={1}>
              {identity.line}
            </Text>
          </View>
        </View>
      ) : null}
      {signIn ? (
        <>
          <PromptCard avatar title="Sign in" subtitle="Save your sets and compete with friends" onPress={signIn.onPress} />
          {signIn.message ? (
            <Text variant="footnote" tone="destructive" style={styles.banner}>
              {signIn.message}
            </Text>
          ) : null}
        </>
      ) : null}
      {pickUsername ? <PromptCard avatar title="Pick a username" subtitle="So friends can find you" onPress={pickUsername} /> : null}

      {identity || challengeRecord !== undefined ? (
        <Segmented
          options={[
            { key: 'sets', label: 'Sets' },
            { key: 'challenges', label: 'Challenges' },
          ]}
          value={segment}
          onChange={(key) => onSegment?.(key)}
          style={styles.segment}
        />
      ) : null}

      {segment === 'challenges' ? (
        <ChallengeStats rec={challengeRecord ?? null} onOpen={onOpenChallenge} onOpenFriend={onOpenFriend} periods={recordPeriods ?? []} period={recordPeriod ?? null} onPeriod={onRecordPeriod} />
      ) : model.empty ? (
        <Card padding={20} style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Icon name="trophy" size={26} color={color.label} />
          </View>
          <Text variant="title2" align="center" style={styles.emptyTitle} accessibilityRole="header">
            Your records live here
          </Text>
          <Text variant="subhead" align="center" style={styles.emptyText}>
            Best set, best day and longest streak show up after your first set.
          </Text>
          <Button title="Start a set" icon="play" onPress={onStartSet} style={styles.emptyButton} />
        </Card>
      ) : (
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <StatTile {...model.tiles[0]} />
            <StatTile {...model.tiles[1]} />
          </View>
          <View style={styles.gridRow}>
            <StatTile {...model.tiles[2]} />
            <StatTile {...model.tiles[3]} />
          </View>
        </View>
      )}

      {segment === 'sets' && model.showGoalRow ? <PromptCard icon="target" title="Set a daily goal" subtitle="Track streaks and a daily target" onPress={onSetGoal} /> : null}

      {segment === 'sets' && model.milestone ? (
        <Card padding={16} style={styles.milestone}>
          <View
            style={styles.milestoneHead}
            accessible
            accessibilityLabel={`${model.milestone.label}: ${formatCount(model.milestone.current)} of ${formatCount(model.milestone.target)}`}
          >
            <Text variant="headline" style={styles.milestoneLabel}>
              {model.milestone.label}
            </Text>
            <Text variant="footnote">
              <Text variant="footnote" tone="label" weight="700">
                {formatCount(model.milestone.current)}
              </Text>
              {` / ${formatCount(model.milestone.target)}`}
            </Text>
          </View>
          <ProgressBar progress={model.milestone.progress} style={styles.bar} />
        </Card>
      ) : null}

      {segment === 'sets' && model.recent.length ? (
        <>
          <SectionHeader title="Recent sets" action="See all" onAction={onAllSets} />
          <ListGroup>
            {model.recent.map((row) => (
              <RecentRow key={row.id} row={row} timeZone={timeZone} nowMs={nowMs} onPress={() => onOpenSet(row.id)} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </ScrollView>
  );
}

function RecentRow({ row, timeZone, nowMs, onPress }: { row: YouRecentRow; timeZone: string; nowMs: number; onPress: () => void }) {
  const when = formatSetDateTime(row.startedAt, nowMs, timeZone);
  return (
    <ListRow
      title={when}
      leading={
        <Text variant="hero" size={22} style={styles.recentReps}>
          {formatCount(row.reps)}
        </Text>
      }
      trailing={row.best ? <Pill label="Best" size="small" /> : undefined}
      chevron
      onPress={onPress}
      accessibilityLabel={`${row.reps} reps, ${when}${row.best ? ', best set' : ''}`}
    />
  );
}

/** Card row for E5 Sign in and E6 Set a daily goal. */
function PromptCard({
  avatar,
  icon,
  title,
  subtitle,
  onPress,
}: {
  avatar?: boolean;
  icon?: 'target';
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [styles.prompt, avatar ? styles.promptTop : styles.promptGoal, pressed && styles.pressed]}
    >
      {avatar ? (
        <Avatar name="?" size={48} />
      ) : (
        <View style={styles.promptTile}>
          <Icon name={icon ?? 'target'} size={17} color={color.label} />
        </View>
      )}
      <View style={styles.grow}>
        <Text variant="headline" style={avatar ? null : styles.promptTitleSmall}>
          {title}
        </Text>
        <Text variant="footnote">{subtitle}</Text>
      </View>
      <Icon name="chev" size={13} color={color.tertiary} />
    </Pressable>
  );
}



function ChallengeStats({
  rec,
  onOpen,
  onOpenFriend,
  periods,
  period,
  onPeriod,
}: {
  rec: MyChallengeRecord | null;
  onOpen?: (id: string) => void;
  onOpenFriend?: (friend: ChallengeFriendRow) => void;
  periods: readonly ChallengeRecordPeriod[];
  period: ChallengeRecordPeriod | null;
  onPeriod?: (period: ChallengeRecordPeriod) => void;
}) {
  const wins = rec?.wins ?? 0;
  const ties = rec?.ties ?? 0;
  const losses = rec?.losses ?? 0;
  const forfeits = rec?.forfeits ?? 0;
  const empty = recordIsEmpty(rec);
  return (
    <>
      <PeriodPicker periods={periods} selected={period} onChange={(p) => onPeriod?.(p)} style={styles.period} />
      <Card padding={16} style={styles.wtlCard}>
        <View style={styles.wtl} accessible accessibilityLabel={`${wins} won, ${ties} tied, ${losses} lost`}>
          <View style={styles.wtlItem}>
            <Text variant="hero" size={34} tone={wins ? undefined : 'secondary'}>
              {String(wins)}
            </Text>
            <Text variant="footnote">Won</Text>
          </View>
          <View style={styles.wtlRule} />
          <View style={styles.wtlItem}>
            <Text variant="hero" size={34} tone="secondary">
              {String(ties)}
            </Text>
            <Text variant="footnote">Tied</Text>
          </View>
          <View style={styles.wtlRule} />
          <View style={styles.wtlItem}>
            <Text variant="hero" size={34} tone="secondary">
              {String(losses)}
            </Text>
            <Text variant="footnote">Lost</Text>
          </View>
        </View>
      </Card>
      {forfeits > 0 ? (
        <Text variant="footnote" align="center" style={styles.forfeitNote}>
          {forfeits === 1 ? '1 forfeit' : `${forfeits} forfeits`}
        </Text>
      ) : null}
      {rec?.friends.length ? (
        <>
          <SectionHeader title="Friends" />
          <ListGroup>
            {rec.friends.map((f) => (
              <ListRow
                key={f.userId}
                title={f.displayName || f.username}
                subtitle={`${f.wins}–${f.ties}–${f.losses}`}
                leading={<Avatar name={f.displayName || f.username} size={36} />}
                chevron
                onPress={onOpenFriend ? () => onOpenFriend(f) : undefined}
              />
            ))}
          </ListGroup>
        </>
      ) : null}
      {rec?.otherEvents.length ? (
        <>
          <SectionHeader title="Other" />
          <ListGroup>
            {rec.otherEvents.map((e) => (
              <ListRow
                key={e.challengeId}
                title={e.title}
                subtitle={e.outcomeLabel}
                chevron
                onPress={onOpen ? () => onOpen(e.challengeId) : undefined}
              />
            ))}
          </ListGroup>
        </>
      ) : null}
      {empty ? (
        <>
          <Text variant="title2" align="center" style={styles.statsEmptyTitle} accessibilityRole="header">
            No challenges yet
          </Text>
          <Text variant="subhead" align="center" style={styles.statsEmptyText}>
            Your record starts with the first one.
          </Text>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: 32 },
  banner: { marginTop: 6 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  grow: { flex: 1, minWidth: 0 },
  grid: { gap: 8, marginTop: 18 },
  gridRow: { flexDirection: 'row', gap: 8 },
  milestone: { paddingTop: 14, paddingBottom: 14, marginTop: 10 },
  milestoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  milestoneLabel: { fontSize: 15 },
  bar: { marginTop: 10 },
  recentReps: { width: 44 },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.separator,
  },
  promptTop: { marginTop: 14 },
  promptGoal: { marginTop: 10 },
  pressed: { opacity: 0.8 },
  promptTile: { width: 30, height: 30, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center', backgroundColor: color.elevated },
  promptTitleSmall: { fontSize: 15 },
  // 12 pt under the profile, same gap Compete uses between its title and segments.
  // Content below (tiles, empty card, period picker) keeps its own top margin.
  segment: { marginTop: space.sm },
  period: { marginTop: 18 },
  wtlCard: { marginBottom: space.sm },
  wtl: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  wtlItem: { alignItems: 'center', flex: 1 },
  wtlRule: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: color.separator },
  forfeitNote: { marginBottom: space.md, marginTop: space.xs },
  statsEmptyTitle: { marginTop: space.xl },
  statsEmptyText: { marginTop: 6 },
  emptyCard: { marginTop: 18, paddingTop: 26, paddingBottom: 26, alignItems: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 14 },
  emptyText: { marginTop: 6 },
  emptyButton: { marginTop: 18, alignSelf: 'stretch' },
});
