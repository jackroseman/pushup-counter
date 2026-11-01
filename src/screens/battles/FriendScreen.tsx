import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { supabase } from '../../backend/supabase';
import { Button, Stat } from '../../components/ui';
import { api } from '../../battles/api';
import { battleTitle, Friend, FriendRecord, friendlyError, personName } from '../../battles/model';
import { AccountGate, Header, Row, s, SectionTitle } from './common';

export function FriendScreen(props: {
  friend: Friend;
  onBack: () => void;
  onChallenge: (f: Friend) => void;
  onOpenBattle: (id: string) => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  const { friend } = props;
  const [rec, setRec] = useState<FriendRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    api.friendRecord(supabase, friend.userId).then((r) => (r.ok ? setRec(r.data) : setError(friendlyError(r.message))));
  }, [friend.userId]);

  const score = (x: { validReps: number | null; metricValue: number | null }) => `${x.validReps ?? Math.round(x.metricValue ?? 0)}`;
  return (
    <ScrollView contentContainerStyle={s.container}>
      <Header title={personName(friend)} onBack={props.onBack} />
      <AccountGate onAccount={props.onAccount} onProfile={props.onProfile}>
        <Text style={[s.muted, { marginBottom: 8 }]}>@{friend.username} · battle results only</Text>
        {error ? <Text style={s.error}>{error}</Text> : null}
        {rec ? (
          <>
            <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
              <Stat label="Battles" value={`${rec.played}`} />
              <Stat label="Won" value={`${rec.won}`} />
              <Stat label="Drawn" value={`${rec.drawn}`} />
              <Stat label="Lost" value={`${rec.lost}`} />
            </View>
            <Text style={[s.muted, { marginTop: 4 }]}>Their record across all their battles.</Text>
            <SectionTitle>You vs {personName(friend)}</SectionTitle>
            {rec.recent.length === 0 ? <Text style={s.muted}>No finished battles together yet.</Text> : null}
            {rec.recent.map((r) => (
              <Row key={r.battleId} onPress={() => props.onOpenBattle(r.battleId)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.bold}>
                    {battleTitle(r)} · {r.me.isWinner && !r.them.isWinner ? 'You won' : r.them.isWinner && !r.me.isWinner ? 'They won' : r.me.rank === r.them.rank ? 'Draw' : r.me.rank && r.them.rank && r.me.rank < r.them.rank ? 'You were ahead' : 'They were ahead'}
                  </Text>
                  <Text style={s.muted}>{new Date(r.finishedAt).toLocaleDateString()}{r.players > 2 ? ` · ${r.players} players` : ''}</Text>
                </View>
                <Text style={s.bold}>
                  {score(r.me)} – {score(r.them)}
                </Text>
              </Row>
            ))}
          </>
        ) : !error ? (
          <Text style={s.muted}>Loading…</Text>
        ) : null}
        <Button title={`Challenge ${personName(friend)}`} onPress={() => props.onChallenge(friend)} />
      </AccountGate>
    </ScrollView>
  );
}
