import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import { Friend, friendlyError, personName } from '../../battles/model';
import { AccountGate, Chip, Header, Row, s, SectionTitle } from './common';

type Format = { format: 'max_reps' } | { format: 'timed'; durationS: number };

export function deadlineLabel(h: number): string {
  if (h % 24 === 0) return h === 24 ? '1 day' : `${h / 24} days`;
  return `${h} hours`;
}

export function NewBattleScreen(props: {
  friendIds?: string[];
  onBack: () => void;
  onCreated: (battleId: string, share: boolean) => void;
  onFriends: () => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Header title="New battle" onBack={props.onBack} />
      <AccountGate onAccount={props.onAccount} onProfile={props.onProfile}>
        <Form {...props} />
      </AccountGate>
    </ScrollView>
  );
}

function Form({ friendIds, onCreated, onFriends }: { friendIds?: string[]; onCreated: (id: string, share: boolean) => void; onFriends: () => void }) {
  const { appSettings } = useBackend();
  const d = appSettings.asyncBattleDefaults;
  const maxInvites = appSettings.asyncMaxParticipants - 1;
  const [format, setFormat] = useState<Format>({ format: 'max_reps' });
  const [hours, setHours] = useState(d.deadlineHours);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(friendIds ?? []));
  const [link, setLink] = useState(!(friendIds && friendIds.length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    api.friends(supabase).then((r) => (r.ok ? setFriends(r.data.filter((f) => f.relation === 'friend')) : setError(friendlyError(r.message))));
  }, []);

  const options = [...new Set([...d.deadlineOptionsHours, d.deadlineHours])].sort((a, b) => a - b);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < maxInvites) n.add(id);
      return n;
    });

  const create = async () => {
    if (!supabase || busy) return;
    if (!picked.size && !link) return setError('Pick a friend or turn on the invite link.');
    setBusy(true);
    setError(null);
    const r = await api.createBattle(supabase, {
      format: format.format,
      durationS: format.format === 'timed' ? format.durationS : undefined,
      deadlineHours: hours,
      friendIds: [...picked],
      inviteLink: link,
    });
    setBusy(false);
    if (!r.ok) return setError(friendlyError(r.message));
    api.kickNotify(supabase);
    onCreated(r.data.battleId, !!r.data.inviteToken);
  };

  return (
    <View>
      <SectionTitle>Format</SectionTitle>
      <View style={s.chips}>
        <Chip label="Max reps" on={format.format === 'max_reps'} onPress={() => setFormat({ format: 'max_reps' })} />
        {d.timedDurationsS.map((t) => (
          <Chip
            key={t}
            label={t % 60 === 0 ? `${t / 60} min` : `${t} s`}
            on={format.format === 'timed' && format.durationS === t}
            onPress={() => setFormat({ format: 'timed', durationS: t })}
          />
        ))}
      </View>
      <Text style={s.muted}>
        {format.format === 'timed'
          ? `Most good reps in ${format.durationS} seconds wins.`
          : `Most good reps in one set wins. A set ends after ${d.maxRepsIdleEndS} s without a rep.`}{' '}
        Shallow reps don't count.
      </Text>

      <SectionTitle>Everyone plays within</SectionTitle>
      <View style={s.chips}>
        {options.map((h) => (
          <Chip key={h} label={deadlineLabel(h)} on={hours === h} onPress={() => setHours(h)} />
        ))}
      </View>

      <SectionTitle>
        Challenge friends ({picked.size}/{maxInvites})
      </SectionTitle>
      {friends === null ? <Text style={s.muted}>Loading friends…</Text> : null}
      {friends && friends.length === 0 ? (
        <Row onPress={onFriends}>
          <Text style={[s.muted, { flex: 1 }]}>No friends yet. Add some, or use an invite link below.</Text>
          <Text style={{ color: colors.accent }}>Add friends ›</Text>
        </Row>
      ) : null}
      {friends?.map((f) => (
        <Row key={f.userId} onPress={() => toggle(f.userId)} style={picked.has(f.userId) ? { borderWidth: 1, borderColor: colors.accent } : undefined}>
          <View style={{ flex: 1 }}>
            <Text style={s.bold}>{personName(f)}</Text>
            <Text style={s.muted}>@{f.username}</Text>
          </View>
          <Text style={{ color: picked.has(f.userId) ? colors.accent : colors.muted, fontSize: 22 }}>{picked.has(f.userId) ? '✓' : '○'}</Text>
        </Row>
      ))}

      <Row>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={s.bold}>Invite link</Text>
          <Text style={s.muted}>Share a link by text or any app. Anyone who opens it can join.</Text>
        </View>
        <Switch value={link} onValueChange={setLink} />
      </Row>

      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button title={busy ? 'Creating…' : 'Create battle'} onPress={create} />
      <Text style={[s.muted, { marginTop: 8 }]}>You can play first. Opponents see your score before they play.</Text>
    </View>
  );
}
