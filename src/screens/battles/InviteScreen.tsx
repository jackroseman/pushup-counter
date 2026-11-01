import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { api } from '../../battles/api';
import { battleTitle, friendlyError, InvitePreview, personName, timeLeft } from '../../battles/model';
import { AccountGate, Header, Notice, Row, s, SectionTitle } from './common';

const PROBLEM: Record<string, string> = {
  not_found: "This invite link doesn't exist.",
  revoked: 'This invite link was turned off.',
  closed: 'This battle is over.',
  expired: 'This invite has expired.',
  used_up: 'This invite link has been used up.',
  full: 'This battle is full.',
};

export function InviteScreen(props: {
  token: string;
  onBack: () => void;
  onJoined: (battleId: string) => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  const { token, onJoined } = props;
  const { session } = useBackend();
  const { profile } = useIdentity();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addFriend, setAddFriend] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    // Works signed out too (anon), so people can see what they're joining before signing in.
    api.invitePreview(supabase, token).then((r) => (r.ok ? setPreview(r.data) : setError(friendlyError(r.message))));
  }, [token, session?.user.id]);

  const join = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const r = await api.redeemInvite(supabase, token, addFriend);
    setBusy(false);
    if (!r.ok) return setError(friendlyError(r.message));
    api.kickNotify(supabase);
    onJoined(r.data);
  };

  const b = preview?.battle;
  const from = preview?.creator ? personName(preview.creator) : 'A friend';
  return (
    <ScrollView contentContainerStyle={s.container}>
      <Header title="Battle invite" onBack={props.onBack} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!preview && !error ? <Text style={s.muted}>Loading…</Text> : null}
      {preview && preview.status !== 'ok' && !preview.member ? <Notice title="Can't join" text={PROBLEM[preview.status] ?? 'This invite is not available.'} /> : null}
      {preview && b ? (
        <View>
          <Text style={[s.text, { fontSize: 22, fontWeight: '800', marginBottom: 4 }]}>
            {from} challenged you: {battleTitle(b)}
          </Text>
          <Text style={s.muted}>
            {b.players}/{b.maxParticipants} players{b.endsAt ? ` · ${timeLeft(b.endsAt)}` : ''}. Only Good and Full reps count.
          </Text>
          {preview.scores?.length ? (
            <>
              <SectionTitle>Scores so far</SectionTitle>
              {preview.scores.map((x, i) => (
                <Row key={i}>
                  <Text style={[s.bold, { flex: 1 }]}>{personName(x)}</Text>
                  <Text style={s.bold}>{x.validReps ?? Math.round(x.metricValue ?? 0)}</Text>
                </Row>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {preview && (preview.status === 'ok' || preview.member) ? (
        <AccountGate onAccount={props.onAccount} onProfile={props.onProfile} why="Battles are played with friends, so you need an account to join.">
          {preview.member && b ? (
            <Button title="Open battle" onPress={() => onJoined(b.id)} />
          ) : (
            <>
              {preview.creator && preview.creator.username !== profile?.username ? (
                <Row style={{ marginTop: 12 }}>
                  <Text style={[s.text, { flex: 1 }]}>Add {from} as a friend</Text>
                  <Switch value={addFriend} onValueChange={setAddFriend} />
                </Row>
              ) : null}
              <Button title={busy ? 'Joining…' : 'Join battle'} onPress={join} />
            </>
          )}
        </AccountGate>
      ) : null}
    </ScrollView>
  );
}
