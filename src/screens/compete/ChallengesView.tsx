import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

import { supabase } from '../../backend/supabase';
import { useIdentity } from '../../backend/IdentityProvider';
import { api } from '../../battles/api';
import { rememberBattles } from '../../battles/battleCache';
import { challengeList, challengesEmpty, type ChallengeRow } from '../../battles/challengeView';
import { Battle, friendlyError } from '../../battles/model';
import { flushBattleUploads, onBattleUploads } from '../../battles/uploader';
import { ChallengeNotifications } from '../../components/NotificationPrompt';
import { REFRESH_FAILED } from '../../progress';
import { Avatar, Button, Card, EmptyState, Icon, ListGroup, ProgressBar, SectionHeader, Text, color, gutter, space } from '../../ui';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Challenges segment of Compete (frame 20, E10, E11). Signed in with a username (the caller gates). */
export function ChallengesView({
  onOpen,
  onNew,
  onInvite,
  hasGoal,
  onNeedGoal,
}: {
  onOpen: (battle: Battle) => void;
  onNew: () => void;
  onInvite: () => void;
  /** Open daily goal on this phone. A streak invite without one goes to the goal sheet. */
  hasGoal: boolean;
  onNeedGoal: () => void;
}) {
  const { profile } = useIdentity();
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [justActed, setJustActed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hadList = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    flushBattleUploads().catch(() => {});
    const [r, f] = await Promise.all([api.myBattles(supabase), api.friends(supabase)]);
    setNow(Date.now());
    if (f.ok) setFriendCount((f.data ?? []).filter((x) => x.relation === 'friend').length);
    if (r.ok) {
      hadList.current = true;
      const rows = r.data ?? [];
      rememberBattles(rows);
      setBattles(rows);
      setError(null);
    } else setError(hadList.current ? REFRESH_FAILED : friendlyError(r.message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => onBattleUploads(() => load()), [load]);
  // A push arriving while the app is open usually means something changed.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => load());
    return () => sub.remove();
  }, [load]);

  const respond = async (b: Battle, accept: boolean) => {
    if (!supabase || !profile || busy) return;
    if (accept && b.kind === 'streak' && !hasGoal) return onNeedGoal();
    setBusy(b.id);
    const r = await api.respond(supabase, b.id, profile.id, accept);
    setBusy(null);
    if (!r.ok) setError(friendlyError(r.message));
    else {
      api.kickNotify(supabase);
      if (accept) setJustActed(true);
    }
    await load();
  };

  const tz = useMemo(() => timeZone(), []);
  const list = useMemo(() => challengeList(battles ?? [], now, tz), [battles, now, tz]);
  const empty = challengesEmpty(battles, friendCount);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          tintColor={color.secondary}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load().catch(() => {});
            setRefreshing(false);
          }}
        />
      }
    >
      <ChallengeNotifications justActed={justActed} onConsumed={() => setJustActed(false)} />
      {error ? (
        <Text variant="footnote" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {battles === null && !error ? <ActivityIndicator style={styles.loading} color={color.secondary} /> : null}

      {empty === 'none' ? (
        <EmptyState
          icon="bolt"
          title="No challenges yet"
          message="Pick a friend and see who does more."
          actionTitle="Challenge a friend"
          onAction={onNew}
          top={100 - space.md}
        />
      ) : null}
      {empty === 'noFriends' ? (
        <EmptyState
          icon="people"
          title="Invite a friend first"
          message="Challenges are head-to-head with people you know."
          actionTitle="Invite friends"
          actionIcon="share"
          onAction={onInvite}
          top={100 - space.md}
        />
      ) : null}

      {list.yourMove.length > 0 ? (
        <>
          <SectionHeader title="Your move" />
          {list.yourMove.map((row, i) => (
            <MoveCard key={row.battle.id} row={row} first={i === 0} busy={busy === row.battle.id} onOpen={onOpen} onRespond={respond} />
          ))}
        </>
      ) : null}

      {list.inProgress.length > 0 ? (
        <>
          <SectionHeader title="In progress" />
          <ListGroup>
            {list.inProgress.map((row) => (
              <ProgressRow key={row.battle.id} row={row} onOpen={onOpen} />
            ))}
          </ListGroup>
        </>
      ) : null}

      {list.finished.length > 0 ? (
        <>
          <SectionHeader title="Finished" />
          <ListGroup>
            {list.finished.map((row) => (
              <FinishedRow key={row.battle.id} row={row} onOpen={onOpen} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </ScrollView>
  );
}

/** "Your move" card: Play on a best set, or Accept / Decline right on the card. */
function MoveCard({
  row,
  first,
  busy,
  onOpen,
  onRespond,
}: {
  row: ChallengeRow;
  first: boolean;
  busy: boolean;
  onOpen: (b: Battle) => void;
  onRespond: (b: Battle, accept: boolean) => void;
}) {
  if (row.type !== 'play' && row.type !== 'invite') return null;
  const head = (
    <View style={styles.moveHead}>
      <Avatar name={row.avatar} size={38} />
      <View style={styles.grow}>
        <Text variant="headline" style={styles.rowTitle} numberOfLines={1}>
          {row.title}
        </Text>
        <Text variant="footnote" numberOfLines={1}>
          {row.subtitle}
        </Text>
      </View>
      {row.type === 'play' ? <Button title="Play" size="small" onPress={() => onOpen(row.battle)} /> : null}
    </View>
  );
  return (
    <Card
      padding={0}
      style={first ? null : styles.nextCard}
      onPress={() => onOpen(row.battle)}
      accessibilityLabel={`${row.title}, ${row.subtitle}`}
    >
      <View style={styles.cardInner}>
        {head}
        {row.type === 'invite' ? (
          <View style={styles.answer}>
            <Button
              title="Decline"
              kind="gray"
              size="small"
              style={styles.flex}
              disabled={busy}
              onPress={() => onRespond(row.battle, false)}
            />
            <Button title="Accept" size="small" style={styles.flex} loading={busy} onPress={() => onRespond(row.battle, true)} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function ProgressRow({ row, onOpen }: { row: ChallengeRow; onOpen: (b: Battle) => void }) {
  if (row.type !== 'progress') return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.right}, ${row.subtitle}`}
      onPress={() => onOpen(row.battle)}
      style={({ pressed }) => [styles.progressRow, pressed && styles.pressed]}
    >
      <View style={styles.spread}>
        <Text variant="headline" style={[styles.rowTitle, styles.grow]} numberOfLines={1}>
          {row.title}
        </Text>
        <Text variant="footnote">{row.right}</Text>
      </View>
      <Text variant="footnote" style={styles.players} numberOfLines={1}>
        {row.subtitle}
      </Text>
      {row.progress != null ? <ProgressBar progress={row.progress} style={styles.bar} /> : null}
    </Pressable>
  );
}

function FinishedRow({ row, onOpen }: { row: ChallengeRow; onOpen: (b: Battle) => void }) {
  if (row.type !== 'finished') return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.day}`}
      onPress={() => onOpen(row.battle)}
      style={({ pressed }) => [styles.finishedRow, pressed && styles.pressed]}
    >
      <View style={styles.mark}>{row.won ? <Icon name="check" size={16} color={color.signal} /> : null}</View>
      <Text variant="body" style={[styles.finishedTitle, styles.grow]} numberOfLines={1}>
        {row.title}
      </Text>
      <Text variant="footnote">{row.day}</Text>
      <Icon name="chev" size={13} color={color.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  error: { marginTop: space.sm },
  loading: { marginTop: 48 },
  nextCard: { marginTop: space.xs },
  cardInner: { paddingVertical: space.sm, paddingHorizontal: 14 },
  moveHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  answer: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, lineHeight: 20 },
  progressRow: { paddingVertical: space.sm, paddingHorizontal: space.md },
  spread: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  players: { marginTop: 2 },
  bar: { marginTop: space.xs },
  finishedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 52 },
  mark: { width: 16, alignItems: 'center' },
  finishedTitle: { fontSize: 15 },
  pressed: { backgroundColor: color.fill.pressed },
});
