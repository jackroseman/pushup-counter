import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { fetchMyLeague } from '../../backend/leagueClient';
import { normalizeUsername } from '../../backend/profile';
import { supabase } from '../../backend/supabase';
import { api } from '../../battles/api';
import { friendRowSubtitle } from '../../battles/friendsView';
import { Friend, friendlyError, groupFriends, personName } from '../../battles/model';
import { Avatar, Button, EmptyState, Icon, ListGroup, ListRow, SectionHeader, Text, color, gutter, space } from '../../ui';

export interface FriendsScreenHandle {
  focusSearch: () => void;
}

/** Friends (frame 26, E13): search, requests, friends with this week's reps, invite with a link. */
export const FriendsScreen = forwardRef<FriendsScreenHandle, { onOpenFriend: (f: Friend) => void; onInvite: () => void }>(
  function FriendsScreen({ onOpenFriend, onInvite }, ref) {
    const [rows, setRows] = useState<Friend[] | null>(null);
    const [weekReps, setWeekReps] = useState<Map<string, number> | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Friend[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const searchSeq = useRef(0);
    const input = useRef<React.ComponentRef<typeof TextInput>>(null);
    useImperativeHandle(ref, () => ({ focusSearch: () => input.current?.focus() }), []);

    const load = useCallback(async () => {
      if (!supabase) return;
      const r = await api.friends(supabase);
      if (r.ok) setRows(r.data);
      else setError(friendlyError(r.message));
      fetchMyLeague(supabase)
        .then((board) => setWeekReps(new Map(board.total.map((row) => [row.userId, row.reps]))))
        .catch(() => setWeekReps(null));
    }, []);
    useFocusEffect(
      useCallback(() => {
        load();
      }, [load]),
    );

    useEffect(() => {
      const q = normalizeUsername(query).replace(/^@/, '');
      if (!supabase || q.length < 2) {
        setResults(null);
        return undefined;
      }
      const seq = ++searchSeq.current;
      const t = setTimeout(async () => {
        const r = await api.searchUsers(supabase!, q);
        if (seq === searchSeq.current) setResults(r.ok ? r.data : []);
      }, 300);
      return () => clearTimeout(t);
    }, [query, rows]);

    const act = async (fn: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
      setError(null);
      setInfo(null);
      const r = await fn();
      if (!r.ok) setError(friendlyError(r.message));
      else {
        if (done) setInfo(done);
        api.kickNotify(supabase!);
      }
      await load();
    };

    const accept = (f: Friend) => act(() => api.respondFriendRequest(supabase!, f.userId, true));
    const requestMenu = (f: Friend) => {
      const ignore = () => act(() => api.respondFriendRequest(supabase!, f.userId, false));
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: `${personName(f)} (@${f.username})`,
            options: ['Add friend', 'Ignore', 'Cancel'],
            destructiveButtonIndex: 1,
            cancelButtonIndex: 2,
          },
          (i) => (i === 0 ? accept(f) : i === 1 ? ignore() : undefined),
        );
      } else {
        Alert.alert(personName(f), `@${f.username}`, [
          { text: 'Add friend', onPress: () => accept(f) },
          { text: 'Ignore', style: 'destructive', onPress: ignore },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    };

    const g = groupFriends(rows ?? []);
    const empty = rows !== null && g.friends.length === 0 && g.incoming.length === 0 && g.outgoing.length === 0 && g.blocked.length === 0;
    const avatar = (f: Friend) => <Avatar name={personName(f)} size={36} />;

    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.search}>
          <Icon name="search" size={17} color={color.tertiary} />
          <TextInput
            ref={input}
            style={styles.searchInput}
            placeholder={empty ? 'Search by username' : 'Search'}
            placeholderTextColor={color.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            accessibilityLabel="Search by username"
          />
        </View>

        {results ? (
          <ListGroup style={styles.results}>
            {results.length === 0 ? <ListRow title="No one found" /> : null}
            {results.map((f) => (
              <ListRow
                key={f.userId}
                title={personName(f)}
                subtitle={`@${f.username}`}
                leading={avatar(f)}
                value={
                  f.relation === 'friend'
                    ? 'Friends'
                    : f.relation === 'outgoing'
                      ? 'Requested'
                      : f.relation === 'blocked'
                        ? 'Blocked'
                        : undefined
                }
                trailing={
                  f.relation === 'none' ? (
                    <Button
                      title="Add"
                      size="small"
                      onPress={() => act(() => api.sendFriendRequest(supabase!, f.username), `Request sent to @${f.username}.`)}
                    />
                  ) : f.relation === 'incoming' ? (
                    <Button title="Add" size="small" onPress={() => accept(f)} />
                  ) : undefined
                }
                onPress={f.relation === 'friend' ? () => onOpenFriend(f) : undefined}
                chevron={f.relation === 'friend'}
              />
            ))}
          </ListGroup>
        ) : null}
        {info ? (
          <Text variant="footnote" style={styles.note}>
            {info}
          </Text>
        ) : null}
        {error ? (
          <Text variant="footnote" tone="destructive" style={styles.note}>
            {error}
          </Text>
        ) : null}

        {rows === null && !error ? <ActivityIndicator style={styles.loading} color={color.secondary} /> : null}

        {empty && !results ? (
          <EmptyState
            icon="people"
            title="No friends yet"
            message="Send a link to the people you work out with."
            actionTitle="Invite with a link"
            actionIcon="share"
            onAction={onInvite}
            top={90}
          />
        ) : null}

        {g.incoming.length ? (
          <>
            <SectionHeader title="Requests" />
            <ListGroup>
              {g.incoming.map((f) => (
                <ListRow
                  key={f.userId}
                  title={personName(f)}
                  subtitle={`@${f.username}`}
                  leading={avatar(f)}
                  trailing={<Button title="Add" size="small" onPress={() => accept(f)} />}
                  onPress={() => requestMenu(f)}
                />
              ))}
            </ListGroup>
          </>
        ) : null}

        {g.friends.length ? (
          <>
            <SectionHeader title={`Friends · ${g.friends.length}`} />
            <ListGroup>
              {g.friends.map((f) => (
                <ListRow
                  key={f.userId}
                  title={personName(f)}
                  subtitle={weekReps ? friendRowSubtitle(weekReps.get(f.userId)) : undefined}
                  leading={avatar(f)}
                  chevron
                  onPress={() => onOpenFriend(f)}
                />
              ))}
            </ListGroup>
          </>
        ) : null}

        {g.outgoing.length ? (
          <>
            <SectionHeader title="Sent requests" />
            <ListGroup>
              {g.outgoing.map((f) => (
                <ListRow
                  key={f.userId}
                  title={personName(f)}
                  subtitle={`@${f.username}`}
                  leading={avatar(f)}
                  trailing={
                    <Button title="Cancel" kind="gray" size="small" onPress={() => act(() => api.removeFriend(supabase!, f.userId))} />
                  }
                />
              ))}
            </ListGroup>
          </>
        ) : null}

        {g.blocked.length ? (
          <>
            <SectionHeader title="Blocked" />
            <ListGroup>
              {g.blocked.map((f) => (
                <ListRow
                  key={f.userId}
                  title={personName(f)}
                  subtitle={`@${f.username}`}
                  leading={avatar(f)}
                  trailing={
                    <Button title="Unblock" kind="gray" size="small" onPress={() => act(() => api.unblockUser(supabase!, f.userId))} />
                  }
                />
              ))}
            </ListGroup>
          </>
        ) : null}

        {!empty && rows !== null ? (
          <ListGroup style={styles.invite}>
            <ListRow title="Invite with a link" leading={<Icon name="share" size={18} color={color.label} />} onPress={onInvite} />
          </ListGroup>
        ) : null}
      </ScrollView>
    );
  },
);

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: space.sm,
    backgroundColor: color.elevated,
  },
  searchInput: { flex: 1, color: color.label, fontSize: 17, paddingVertical: space.xs },
  results: { marginTop: space.sm },
  note: { marginTop: space.xs, marginHorizontal: space.xxs },
  loading: { marginTop: 48 },
  invite: { marginTop: space.md },
});
