import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { fetchMyLeague } from '../../backend/leagueClient';
import { supabase } from '../../backend/supabase';
import { api } from '../../battles/api';
import { friendBestSet, friendChallengeRows, headToHeadRecord } from '../../battles/friendsView';
import { Battle, Friend, FriendRecord, friendlyError, personName } from '../../battles/model';
import { formatCount } from '../../progress';
import { Avatar, Button, Card, Icon, ListGroup, SectionHeader, Text, color, gutter, space } from '../../ui';

export type FriendMenuItem = { label: string; destructive?: boolean; onPress: () => void };

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** A friend's page (frame 27, E14): this week, best set, your record together, challenges, Challenge X. */
export function FriendScreen({
  friend,
  onChallenge,
  onOpenBattle,
  onRemoved,
  onHeader,
}: {
  friend: Friend;
  onChallenge: (f: Friend) => void;
  onOpenBattle: (id: string) => void;
  /** After Remove or Block: leave the page. */
  onRemoved: () => void;
  onHeader: (menu: FriendMenuItem[]) => void;
}) {
  const name = personName(friend);
  const [rec, setRec] = useState<FriendRecord | null>(null);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [week, setWeek] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!supabase) return;
    api.friendRecord(supabase, friend.userId).then((r) => (r.ok ? setRec(r.data) : setError(friendlyError(r.message))));
    api.myBattles(supabase).then((r) => r.ok && setBattles(r.data ?? []));
    fetchMyLeague(supabase)
      .then((board) => setWeek(board.total.find((row) => row.userId === friend.userId)?.reps ?? null))
      .catch(() => setWeek(null));
  }, [friend.userId]);

  const leave = useCallback(
    async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
      const r = await fn();
      if (!r.ok) return setError(friendlyError(r.message));
      api.kickNotify(supabase!);
      onRemoved();
    },
    [onRemoved],
  );
  useLayoutEffect(() => {
    onHeader([
      {
        label: 'Remove friend',
        destructive: true,
        onPress: () =>
          Alert.alert(`Remove ${name}?`, undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => leave(() => api.removeFriend(supabase!, friend.userId)) },
          ]),
      },
      {
        label: 'Block',
        destructive: true,
        onPress: () =>
          Alert.alert(`Block ${name}?`, 'Open invites between you are declined.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => leave(() => api.blockUser(supabase!, friend.userId)) },
          ]),
      },
    ]);
  }, [friend.userId, name, onHeader, leave]);

  const rows = useMemo(() => friendChallengeRows(friend.userId, battles, rec, now, timeZone()), [friend.userId, battles, rec, now]);
  const record = rec ? headToHeadRecord(rec) : null;
  const best = friendBestSet(rec);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Avatar name={name} size={76} />
          <Text variant="title1" align="center" style={styles.name}>
            {name}
          </Text>
          <Text variant="footnote" align="center">{`@${friend.username}`}</Text>
        </View>

        <View style={styles.tiles}>
          <Tile label="This week" value={week == null ? '–' : formatCount(week)} dim={!week} />
          <Tile label="Best set" value={best == null ? '–' : formatCount(best)} dim={best == null} />
        </View>

        {error ? (
          <Text variant="footnote" tone="destructive" style={styles.note}>
            {error}
          </Text>
        ) : null}
        {!rec && !error ? <ActivityIndicator style={styles.loading} color={color.secondary} /> : null}

        {rec && record && record.together > 0 ? (
          <Card padding={0} style={styles.record}>
            <View style={styles.recordRow}>
              <View style={styles.recordSide} accessible accessibilityLabel={`You won ${record.youWon}`}>
                <Text variant="hero" size={34}>
                  {String(record.youWon)}
                </Text>
                <Text variant="footnote">You won</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.recordSide} accessible accessibilityLabel={`${name} won ${record.theyWon}`}>
                <Text variant="hero" size={34} tone="secondary">
                  {String(record.theyWon)}
                </Text>
                <Text variant="footnote" numberOfLines={1}>{`${name} won`}</Text>
              </View>
            </View>
          </Card>
        ) : null}
        {rec && record && record.together === 0 && rows.length === 0 ? (
          <Card padding={0} style={styles.record}>
            <View style={styles.none}>
              <Text variant="headline" align="center">
                No challenges yet
              </Text>
              <Text variant="subhead" tone="secondary" align="center" style={styles.noneLine}>
                {`Your record with ${name} starts with the first one.`}
              </Text>
            </View>
          </Card>
        ) : null}

        {rows.length > 0 ? (
          <>
            <SectionHeader title="Challenges" />
            <ListGroup>
              {rows.map((r) => (
                <Pressable
                  key={r.challengeId}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.title}, ${r.status}`}
                  onPress={() => onOpenBattle(r.challengeId)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Text variant="body" style={styles.grow} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text variant="footnote">{r.status}</Text>
                  <Icon name="chev" size={13} color={color.tertiary} />
                </Pressable>
              ))}
            </ListGroup>
          </>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button title={`Challenge ${name}`} onPress={() => onChallenge(friend)} />
      </View>
    </View>
  );
}

function Tile({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <Card padding={12} style={styles.tile}>
      <Text variant="footnote" weight="500" align="center" accessible accessibilityLabel={`${label}: ${value}`}>
        {label}
      </Text>
      <Text variant="hero" size={28} tone={dim ? 'tertiary' : 'label'} align="center" style={styles.tileValue}>
        {value}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  head: { alignItems: 'center', marginTop: 10 },
  name: { marginTop: space.sm },
  tiles: { flexDirection: 'row', gap: space.xs, marginTop: 22 },
  tile: { flex: 1, alignItems: 'center' },
  tileValue: { marginTop: 6 },
  note: { marginTop: space.sm },
  loading: { marginTop: 32 },
  record: { marginTop: 10 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-around', padding: space.md },
  recordSide: { alignItems: 'center', flex: 1 },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: color.separator },
  none: { paddingVertical: 22, paddingHorizontal: space.md },
  noneLine: { marginTop: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 52 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: color.fill.pressed },
  footer: { paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
});
