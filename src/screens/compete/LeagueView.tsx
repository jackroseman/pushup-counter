import React from 'react';
import { ActionSheetIOS, ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, EmptyState, Icon, LeaderRow, ListGroup, Podium, Text, color, gutter, space } from '../../ui';
import { formatCount } from '../../progress';
import { LEAGUE_MODE_LABEL, hasCrown, type LeagueMode, type LeaguePerson, type LeagueView as Model } from '../../progress/leagueView';

const MODES: LeagueMode[] = ['total', 'improvement'];

/**
 * League segment of Compete (frames 18, 19, E8, E9). Pure layout over `leagueView()`.
 * `view` is null while the first board loads.
 */
export function LeagueView({
  view,
  mode,
  onMode,
  banner,
  onStart,
  onInvite,
  onOpenPerson,
  onInfo,
}: {
  view: Model | null;
  mode: LeagueMode;
  onMode: (mode: LeagueMode) => void;
  banner: string | null;
  onStart: () => void;
  onInvite: () => void;
  onOpenPerson: (person: LeaguePerson) => void;
  /** The (i): how Total and Improvement work. */
  onInfo: () => void;
}) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {banner ? (
        <Text variant="footnote" style={styles.banner}>
          {banner}
        </Text>
      ) : null}
      {!view && !banner ? <ActivityIndicator style={styles.loading} color={color.secondary} /> : null}
      {view?.kind === 'empty' ? (
        <EmptyState
          icon="people"
          title="Your league is empty"
          message="Invite a few friends and see who does the most push-ups each week."
          actionTitle="Invite friends"
          actionIcon="share"
          onAction={onInvite}
          top={110 - space.md}
        />
      ) : null}
      {view && view.kind !== 'empty' ? (
        <View style={styles.header}>
          <Text variant="footnote" weight="500">
            {view.header}
          </Text>
          <View style={styles.headerRight}>
            <Pressable accessibilityRole="button" accessibilityLabel="How the league works" onPress={onInfo} hitSlop={12}>
              <Icon name="info" size={16} color={color.secondary} />
            </Pressable>
            {view.kind === 'newWeek' ? (
              <Text variant="footnote" weight="500" tone="label">
                {LEAGUE_MODE_LABEL.total}
              </Text>
            ) : (
              <ModePicker mode={mode} onMode={onMode} />
            )}
          </View>
        </View>
      ) : null}

      {view?.kind === 'newWeek' ? (
        <>
          <Card padding={0} style={styles.startCard}>
            <View style={styles.startInner}>
              <Text variant="title2" align="center">
                The week just started
              </Text>
              <Text variant="subhead" align="center" style={styles.startLine}>
                Everyone starts at 0.
              </Text>
            </View>
          </Card>
          <ListGroup style={styles.group}>
            {view.people.map((p) => (
              <PersonRow key={p.userId} person={p} dim onPress={p.me ? undefined : () => onOpenPerson(p)} />
            ))}
          </ListGroup>
          <Card padding={0} style={styles.meCard}>
            <View style={styles.meInner}>
              <View style={styles.meText}>
                <Text variant="headline" style={styles.meTitle}>
                  Be the first on the board
                </Text>
              </View>
              <Button title="Start a set" size="small" onPress={onStart} />
            </View>
          </Card>
        </>
      ) : null}

      {view?.kind === 'notStarted' ? (
        <>
          <ListGroup style={styles.group}>
            {view.people.map((p) => (
              <PersonRow key={p.userId} person={p} rank onPress={() => onOpenPerson(p)} />
            ))}
          </ListGroup>
          <Card padding={0} style={styles.meCard}>
            <View style={styles.meInner}>
              <Text variant="footnote" style={styles.rank} tabular>
                –
              </Text>
              <Avatar name={view.me.name} me size={30} />
              <View style={styles.meText}>
                <Text variant="headline" style={styles.meTitle}>
                  {`You · ${formatCount(view.me.score)}`}
                </Text>
                {view.line ? <Text variant="footnote">{view.line}</Text> : null}
              </View>
              <Button title="Start a set" size="small" onPress={onStart} />
            </View>
          </Card>
        </>
      ) : null}

      {view?.kind === 'board' ? (
        <>
          <Podium
            style={styles.podium}
            entries={view.podium.map((p) => ({
              name: p.name,
              score: formatCount(p.score),
              me: p.me,
            }))}
          />
          {view.rest.length > 0 ? (
            <ListGroup style={styles.attached}>
              {view.rest.map((p) => (
                <LeaderRow
                  key={p.userId}
                  rank={p.rank}
                  name={p.name}
                  score={formatCount(p.score)}
                  me={p.me}
                  onPress={p.me ? undefined : () => onOpenPerson(p)}
                />
              ))}
            </ListGroup>
          ) : (
            <View style={styles.podiumBase} />
          )}
          {view.me ? (
            <Card padding={0} style={styles.meCard}>
              <View style={styles.meInner}>
                <Avatar name={view.me.name} me size={30} />
                <View style={styles.meText}>
                  <Text variant="headline" style={styles.meTitle}>
                    {view.title}
                  </Text>
                  {view.line ? <Text variant="footnote">{view.line}</Text> : null}
                </View>
                <Button title="Start a set" size="small" onPress={onStart} />
              </View>
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

/** "Total ⌄": a native menu to switch between the two boards. */
function ModePicker({ mode, onMode }: { mode: LeagueMode; onMode: (mode: LeagueMode) => void }) {
  const open = () => {
    if (Platform.OS === 'ios') {
      const options = [...MODES.map((m) => LEAGUE_MODE_LABEL[m]), 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: MODES.length }, (index) => {
        if (index < MODES.length) onMode(MODES[index]);
      });
    } else {
      onMode(mode === 'total' ? 'improvement' : 'total');
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Board: ${LEAGUE_MODE_LABEL[mode]}`}
      accessibilityHint="Switches between Total and Improvement"
      onPress={open}
      hitSlop={12}
      style={styles.picker}
    >
      <Text variant="footnote" weight="500" tone="label">
        {LEAGUE_MODE_LABEL[mode]}
      </Text>
      <Icon name="chev" size={10} color={color.label} style={styles.down} />
    </Pressable>
  );
}

/** A board row for the new-week and not-started lists: optional rank, avatar, name (+ crown), score. */
function PersonRow({ person, rank, dim, onPress }: { person: LeaguePerson; rank?: boolean; dim?: boolean; onPress?: () => void }) {
  const name = person.me ? 'You' : person.name;
  const score = formatCount(person.score);
  const content = (
    <>
      {rank ? (
        <Text variant="footnote" style={styles.rank} tabular>
          {String(person.rank)}
        </Text>
      ) : null}
      <Avatar name={person.name} me={person.me} size={30} />
      <View style={styles.nameRow}>
        <Text variant="body" weight={person.me ? '600' : undefined} numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {hasCrown(person) ? <Icon name="crown" size={13} color={color.label} style={styles.crown} /> : null}
      </View>
      <Text variant="headline" weight="700" tabular tone={dim ? 'tertiary' : 'label'} style={styles.score}>
        {score}
      </Text>
    </>
  );
  const label = `${rank ? `${person.rank}. ` : ''}${name}, ${score}`;
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  banner: { marginTop: space.sm },
  loading: { marginTop: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    minHeight: 52,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  down: { transform: [{ rotate: '90deg' }] },
  podium: { marginTop: space.md },
  attached: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  podiumBase: { height: 1, backgroundColor: color.separator },
  startCard: { marginTop: 14 },
  startInner: { paddingVertical: 22, paddingHorizontal: 18 },
  startLine: { marginTop: 6 },
  group: { marginTop: space.sm },
  meCard: { marginTop: space.sm, borderColor: color.tertiary },
  meInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: 14,
  },
  meText: { flex: 1, minWidth: 0 },
  meTitle: { fontSize: 15, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 52,
  },
  pressed: { backgroundColor: color.fill.pressed },
  rank: { width: 16 },
  nameRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: { flexShrink: 1 },
  crown: { marginTop: -2 },
  score: { fontSize: 18, lineHeight: 22 },
});
