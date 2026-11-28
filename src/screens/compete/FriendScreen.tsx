import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { fetchMyLeague } from '../../backend/leagueClient';
import { supabase } from '../../backend/supabase';
import { api } from '../../battles/api';
import { friendBestSet, friendChallengeRows } from '../../battles/friendsView';
import { Battle, Friend, FriendRecord, friendlyError, personName } from '../../battles/model';
import type { OpenChallenge } from '../../battles/openChallenges';
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
  const [open, setOpen] = useState<OpenChallenge[]>([]);
  const [week, setWeek] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!supabase) return;
    api.friendRecord(supabase, friend.userId).then((r) => (r.ok ? setRec(r.data) : setError(friendlyError(r.message))));
    api.myBattles(supabase).then((r) => r.ok && setBattles(r.data ?? []));
    api.myOpenChallenges(supabase).then((r) => r.ok && setOpen(r.data ?? []));
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

  const rows = useMemo(() => friendChallengeRows(friend.userId, battles, rec, now, timeZone(), open), [friend.userId, battles, rec, now, open]);
  const wins = rec?.wins ?? rec?.won ?? 0;
  const ties = rec?.ties ?? rec?.drawn ?? 0;
  const losses = rec?.losses ?? rec?.lost ?? 0;
  const forfeits = rec?.forfeits ?? 0;
  const together = wins + ties + losses + forfeits;
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

        {rec && together > 0 ? (
          <Text variant="footnote" style={styles.period}>
            Last 30 days
          </Text>
        ) : null}
        {rec && together > 0 ? (
          <Card padding={0} style={styles.record}>
            <View style={styles.recordRow}>
              <View style={styles.recordSide} accessible accessibilityLabel={`${wins} wins`}>
                <Text variant="hero" size={34}>
                  {String(wins)}
                </Text>
                <Text variant="footnote">Wins</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.recordSide} accessible accessibilityLabel={`${ties} ties`}>
                <Text variant="hero" size={34} tone="secondary">
                  {String(ties)}
                </Text>
                <Text variant="footnote">Ties</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.recordSide} accessible accessibilityLabel={`${losses} losses`}>
                <Text variant="hero" size={34} tone="secondary">
                  {String(losses)}
                </Text>
                <Text variant="footnote">Losses</Text>
              </View>
            </View>
            {forfeits > 0 ? (
              <Text variant="footnote" align="center" style={styles.forfeitNote}>
                {forfeits === 1 ? '1 forfeit' : `${forfeits} forfeits`}
              </Text>
            ) : null}
          </Card>
        ) : null}
        {rec && together === 0 && rows.length === 0 ? (
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

        {rows.some((r) => r.section === 'open') ? (
          <>
            <SectionHeader title="In progress" />
            <ListGroup>
              {rows
                .filter((r) => r.section === 'open')
                .map((r) => (
                  <FriendChallengeItem key={r.challengeId} row={r} onOpen={onOpenBattle} />
                ))}
            </ListGroup>
          </>
        ) : null}
        {rows.some((r) => r.section === 'finished') ? (
          <>
            <SectionHeader title="Finished" />
            <ListGroup>
              {rows
                .filter((r) => r.section === 'finished')
                .map((r) => (
                  <FriendChallengeItem key={r.challengeId} row={r} onOpen={onOpenBattle} />
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

function FriendChallengeItem({
  row,
  onOpen,
}: {
  row: { challengeId: string; title: string; status: string };
  onOpen: (id: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.status}`}
      onPress={() => onOpen(row.challengeId)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text variant="body" style={styles.grow} numberOfLines={1}>
        {row.title}
      </Text>
      <Text variant="footnote">{row.status}</Text>
      <Icon name="chev" size={13} color={color.tertiary} />
    </Pressable>
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
  period: { marginTop: space.md, marginBottom: space.xs },
  record: { marginTop: 10 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-around', padding: space.md },
  recordSide: { alignItems: 'center', flex: 1 },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: color.separator },
  none: { paddingVertical: 22, paddingHorizontal: space.md },
  forfeitNote: { paddingBottom: space.sm },
  noneLine: { marginTop: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 52 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: color.fill.pressed },
  footer: { paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
});
