import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

import { supabase } from '../../backend/supabase';
import { useIdentity } from '../../backend/IdentityProvider';
import { api } from '../../battles/api';
import { rememberBattles } from '../../battles/battleCache';
import { challengesEmpty } from '../../battles/challengeView';
import { Battle, friendlyError } from '../../battles/model';
import type { OpenChallenge } from '../../battles/openChallenges';
import { flushBattleUploads, onBattleUploads } from '../../battles/uploader';
import { ChallengeNotifications } from '../../components/NotificationPrompt';
import { REFRESH_FAILED } from '../../progress';
import { EmptyState, Text, color, gutter, space } from '../../ui';
import { YourTurnList } from './YourTurnList';

/** Challenges segment of Compete (frame 20, E10, E11). Signed in with a username (the caller gates). */
export function ChallengesView({
  onOpen,
  onNew,
  onInvite,
  onStats,
  hasGoal,
  onNeedGoal,
}: {
  onOpen: (battle: Battle) => void;
  onNew: () => void;
  onInvite: () => void;
  onStats: () => void;
  /** Open daily goal on this phone. A streak invite without one goes to the goal sheet. */
  hasGoal: boolean;
  onNeedGoal: () => void;
}) {
  const { profile } = useIdentity();
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [open, setOpen] = useState<OpenChallenge[] | null>(null);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [justActed, setJustActed] = useState(false);
  const hadList = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    flushBattleUploads().catch(() => {});
    const [r, o, f] = await Promise.all([api.myBattles(supabase), api.myOpenChallenges(supabase), api.friends(supabase)]);
    if (f.ok) setFriendCount((f.data ?? []).filter((x) => x.relation === 'friend').length);
    if (o.ok) setOpen(o.data ?? []);
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

  const empty = open != null && open.length === 0 ? challengesEmpty([], friendCount) : null;

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

      {open && open.length > 0 ? (
        <YourTurnList
          rows={open}
          onOpen={(id) => {
            const battle = (battles ?? []).find((b) => b.id === id);
            if (battle) onOpen(battle);
            else onOpen({ id } as Battle);
          }}
          onRespond={(row, accept) => {
            const battle = (battles ?? []).find((b) => b.id === row.challengeId);
            if (battle) respond(battle, accept);
          }}
          busyId={busy}
        />
      ) : null}

      {friendCount ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See challenge stats"
          onPress={onStats}
          style={({ pressed }) => [styles.stats, pressed && styles.pressed]}
        >
          <Text variant="body" style={styles.grow}>
            See challenge stats
          </Text>
          <Text variant="footnote">Last 30 days</Text>
        </Pressable>
      ) : null}
    </ScrollView>
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
  stats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.lg, paddingVertical: space.sm },
  pressed: { backgroundColor: color.fill.pressed },
});
