import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../../backend/supabase';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import { Battle, battleSubtitle, battleTitle, friendlyError, groupBattles, personName } from '../../battles/model';
import { flushBattleUploads, onBattleUploads } from '../../battles/uploader';
import { AccountGate, Header, Notice, Row, s, SectionTitle } from './common';

export function BattlesScreen({
  onBack,
  onOpen,
  onNew,
  onFriends,
  onAccount,
  onProfile,
}: {
  onBack: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onFriends: () => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  const reload = useRef<(() => Promise<void>) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      contentContainerStyle={s.container}
      refreshControl={
        <RefreshControl
          tintColor={colors.muted}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await reload.current?.().catch(() => {});
            setRefreshing(false);
          }}
        />
      }
    >
      <Header title="Battles" onBack={onBack} />
      <AccountGate onAccount={onAccount} onProfile={onProfile}>
        <BattleList onOpen={onOpen} onNew={onNew} onFriends={onFriends} reload={reload} />
      </AccountGate>
    </ScrollView>
  );
}

function BattleList({
  onOpen,
  onNew,
  onFriends,
  reload,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  onFriends: () => void;
  reload: React.MutableRefObject<(() => Promise<void>) | null>;
}) {
  const { push } = useIdentity();
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    flushBattleUploads().catch(() => {});
    const r = await api.myBattles(supabase);
    if (r.ok) {
      setBattles(r.data ?? []);
      setError(null);
    } else setError(friendlyError(r.message));
  }, []);
  reload.current = load;

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

  const g = groupBattles(battles ?? []);
  const item = (b: Battle) => {
    const others = b.participants.filter((p) => !p.isMe).map(personName);
    return (
      <Row key={b.id} onPress={() => onOpen(b.id)}>
        <View style={{ flex: 1 }}>
          <Text style={s.bold}>
            {battleTitle(b)} · {others.length ? others.slice(0, 3).join(', ') + (others.length > 3 ? ` +${others.length - 3}` : '') : 'just you so far'}
          </Text>
          <Text style={s.muted}>{battleSubtitle(b)}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
      </Row>
    );
  };

  return (
    <View>
      <Button title="New battle" onPress={onNew} />
      <Button title="Friends" kind="secondary" onPress={onFriends} />

      {push.permission !== 'granted' ? (
        <View style={{ marginTop: 12 }}>
          <Notice title="Get battle notifications" text="Know when a friend challenges you, when the deadline is close, and who won.">
            <Button
              title="Turn on notifications"
              kind="secondary"
              onPress={async () => {
                const r = await push.enable();
                setPushMsg(r.ok ? 'Notifications are on.' : r.message ?? "Couldn't turn them on.");
              }}
            />
            {pushMsg ? <Text style={[s.muted, { marginTop: 8 }]}>{pushMsg}</Text> : null}
          </Notice>
        </View>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {battles === null && !error ? <Text style={[s.muted, { marginTop: 16 }]}>Loading…</Text> : null}
      {battles && battles.length === 0 ? (
        <Text style={[s.muted, { marginTop: 16 }]}>No battles yet. Start one and challenge a friend, or share an invite link.</Text>
      ) : null}
      {g.yourMove.length ? <SectionTitle>Your move</SectionTitle> : null}
      {g.yourMove.map(item)}
      {g.waiting.length ? <SectionTitle>Waiting on others</SectionTitle> : null}
      {g.waiting.map(item)}
      {g.finished.length ? <SectionTitle>Results (last 30 days)</SectionTitle> : null}
      {g.finished.map(item)}
    </View>
  );
}
