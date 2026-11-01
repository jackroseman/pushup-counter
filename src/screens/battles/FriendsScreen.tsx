import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../backend/supabase';
import { useIdentity } from '../../backend/IdentityProvider';
import { normalizeUsername } from '../../backend/profile';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import { Friend, friendlyError, groupFriends, personName } from '../../battles/model';
import { AccountGate, Header, Row, s, SectionTitle, SmallButton } from './common';

export function FriendsScreen(props: {
  onBack: () => void;
  onOpenFriend: (f: Friend) => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Header title="Friends" onBack={props.onBack} />
      <AccountGate onAccount={props.onAccount} onProfile={props.onProfile} why="Friends are linked to accounts.">
        <Friends onOpenFriend={props.onOpenFriend} />
      </AccountGate>
    </ScrollView>
  );
}

function Friends({ onOpenFriend }: { onOpenFriend: (f: Friend) => void }) {
  const { profile } = useIdentity();
  const [rows, setRows] = useState<Friend[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Friend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    if (!supabase) return;
    const r = await api.friends(supabase);
    if (r.ok) setRows(r.data);
    else setError(friendlyError(r.message));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    const q = normalizeUsername(query).replace(/^@/, '');
    if (!supabase || q.length < 2) return setResults(null);
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

  const manage = (f: Friend) =>
    Alert.alert(personName(f), `@${f.username}`, [
      { text: 'Remove friend', style: 'destructive', onPress: () => act(() => api.removeFriend(supabase!, f.userId)) },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => act(() => api.blockUser(supabase!, f.userId), `Blocked @${f.username}. Open invites between you were declined.`),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const g = groupFriends(rows ?? []);
  const name = (f: Friend) => (
    <View style={{ flex: 1 }}>
      <Text style={s.bold}>{personName(f)}</Text>
      <Text style={s.muted}>@{f.username}</Text>
    </View>
  );

  return (
    <View>
      <Text style={[s.muted, { marginBottom: 8 }]}>
        You're @{profile?.username}. Friends can challenge each other and see each other's battle results. Nothing else is shared.
      </Text>
      <TextInput
        style={s.input}
        placeholder="Find people by username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />
      {results ? (
        <View style={{ marginTop: 8 }}>
          {results.length === 0 ? <Text style={s.muted}>No one found.</Text> : null}
          {results.map((f) => (
            <Row key={f.userId}>
              {name(f)}
              {f.relation === 'none' ? (
                <SmallButton title="Add" onPress={() => act(() => api.sendFriendRequest(supabase!, f.username), `Request sent to @${f.username}.`)} />
              ) : f.relation === 'incoming' ? (
                <SmallButton title="Accept" onPress={() => act(() => api.respondFriendRequest(supabase!, f.userId, true))} />
              ) : (
                <Text style={s.muted}>{f.relation === 'friend' ? 'Friends ✓' : f.relation === 'outgoing' ? 'Requested' : 'Blocked'}</Text>
              )}
            </Row>
          ))}
        </View>
      ) : null}
      {info ? <Text style={[s.muted, { marginTop: 8, color: colors.quality.full }]}>{info}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {g.incoming.length ? <SectionTitle>Requests</SectionTitle> : null}
      {g.incoming.map((f) => (
        <Row key={f.userId}>
          {name(f)}
          <SmallButton title="Accept" onPress={() => act(() => api.respondFriendRequest(supabase!, f.userId, true))} />
          <SmallButton title="Ignore" kind="secondary" onPress={() => act(() => api.respondFriendRequest(supabase!, f.userId, false))} />
        </Row>
      ))}

      <SectionTitle>Friends</SectionTitle>
      {rows === null ? <Text style={s.muted}>Loading…</Text> : null}
      {rows && g.friends.length === 0 ? <Text style={s.muted}>No friends yet. Search above, or send someone a battle invite link.</Text> : null}
      {g.friends.map((f) => (
        <Row key={f.userId} onPress={() => onOpenFriend(f)}>
          {name(f)}
          <SmallButton title="•••" kind="secondary" onPress={() => manage(f)} />
          <Text style={{ color: colors.muted, fontSize: 22, marginLeft: 8 }}>›</Text>
        </Row>
      ))}

      {g.outgoing.length ? <SectionTitle>Sent requests</SectionTitle> : null}
      {g.outgoing.map((f) => (
        <Row key={f.userId}>
          {name(f)}
          <SmallButton title="Cancel" kind="secondary" onPress={() => act(() => api.removeFriend(supabase!, f.userId))} />
        </Row>
      ))}

      {g.blocked.length ? <SectionTitle>Blocked</SectionTitle> : null}
      {g.blocked.map((f) => (
        <Row key={f.userId}>
          {name(f)}
          <SmallButton title="Unblock" kind="secondary" onPress={() => act(() => api.unblockUser(supabase!, f.userId))} />
        </Row>
      ))}
    </View>
  );
}
