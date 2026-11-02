import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import { challengeFormats, ChallengeFormat } from '../../battles/challengeFromSet';
import { countedReps } from '../../battles/counting';
import { Friend, friendlyError, personName } from '../../battles/model';
import { submitBattleAttempt } from '../../battles/uploader';
import { SessionRecord } from '../../storage/history';
import { AccountGate, Chip, Header, Row, s, SectionTitle } from './common';

type Format = { format: 'max_reps' } | { format: 'timed'; durationS: number } | { format: 'multi_day' };

export function deadlineLabel(h: number): string {
  if (h % 24 === 0) return h === 24 ? '1 day' : `${h / 24} days`;
  return `${h} hours`;
}

export function windowLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export function NewBattleScreen(props: {
  friendIds?: string[];
  /** The set that just finished. Creating the battle uses it as your attempt. */
  fromSet?: SessionRecord;
  onBack: () => void;
  onCreated: (
    battleId: string,
    share: boolean,
    extras?: { promptAttempt?: boolean; justPlayed?: { reps: number; counted: number } },
  ) => void;
  onFriends: () => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Header title={props.fromSet ? 'Challenge a friend' : 'New battle'} onBack={props.onBack} />
      <AccountGate onAccount={props.onAccount} onProfile={props.onProfile}>
        <Form {...props} />
      </AccountGate>
    </ScrollView>
  );
}

function Form({
  friendIds,
  fromSet,
  onCreated,
  onFriends,
}: {
  friendIds?: string[];
  fromSet?: SessionRecord;
  onCreated: (id: string, share: boolean, extras?: { promptAttempt?: boolean; justPlayed?: { reps: number; counted: number } }) => void;
  onFriends: () => void;
}) {
  const { appSettings } = useBackend();
  const { deviceId } = useIdentity();
  const d = appSettings.asyncBattleDefaults;
  const maxInvites = appSettings.asyncMaxParticipants - 1;
  const offered: ChallengeFormat[] | null = fromSet ? challengeFormats(fromSet, d.timedDurationsS) : null;
  const [format, setFormat] = useState<Format>({ format: 'max_reps' });
  const [hours, setHours] = useState(d.deadlineHours);
  const [windowDays, setWindowDays] = useState(d.multiDayWindowDays);
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
    if (offered && offered.length === 0) return setError('This set is already in a battle.');
    if (!picked.size && !link) return setError('Pick a friend or turn on the invite link.');
    setBusy(true);
    setError(null);
    const r = await api.createBattle(supabase, {
      format: format.format,
      durationS: format.format === 'timed' ? format.durationS : undefined,
      windowDays: format.format === 'multi_day' ? windowDays : undefined,
      deadlineHours: hours,
      friendIds: [...picked],
      inviteLink: link,
    });
    if (!r.ok) {
      setBusy(false);
      return setError(friendlyError(r.message));
    }
    let promptAttempt = !fromSet;
    let justPlayed: { reps: number; counted: number } | undefined;
    if (fromSet) {
      const rules = format.format === 'timed' ? { format: 'timed' as const, durationS: format.durationS } : { format: 'max_reps' as const, durationS: null };
      try {
        const flushed = await submitBattleAttempt(fromSet, r.data.battleId, deviceId, { linkFinishedSet: true });
        const failed = flushed?.failed.some((f) => f.payload.id === fromSet.id) ?? false;
        if (failed) {
          promptAttempt = true;
          setError(friendlyError(flushed?.failed.find((f) => f.payload.id === fromSet.id)?.error));
        } else {
          justPlayed = { reps: fromSet.reps.length, counted: countedReps(fromSet.reps, fromSet.startedAt, rules) };
        }
      } catch (e) {
        promptAttempt = true;
        setError(friendlyError(e instanceof Error ? e.message : String(e)));
      }
    }
    setBusy(false);
    api.kickNotify(supabase);
    onCreated(r.data.battleId, !!r.data.inviteToken, { promptAttempt, justPlayed });
  };

  return (
    <View>
      <SectionTitle>Format</SectionTitle>
      <View style={s.chips}>
        {offered ? (
          offered.map((f) => (
            <Chip
              key={f.format}
              label={f.format === 'timed' ? (f.durationS! % 60 === 0 ? `${f.durationS! / 60} min` : `${f.durationS} s`) : f.format === 'multi_day' ? 'Multi-day' : 'Max reps'}
              on={format.format === f.format}
              onPress={() => setFormat(f.format === 'timed' ? { format: 'timed', durationS: f.durationS! } : { format: f.format })}
            />
          ))
        ) : (
          <>
            <Chip label="Max reps" on={format.format === 'max_reps'} onPress={() => setFormat({ format: 'max_reps' })} />
            {d.timedDurationsS.map((t) => (
              <Chip
                key={t}
                label={t % 60 === 0 ? `${t / 60} min` : `${t} s`}
                on={format.format === 'timed' && format.durationS === t}
                onPress={() => setFormat({ format: 'timed', durationS: t })}
              />
            ))}
          </>
        )}
      </View>
      <Text style={s.muted}>
        {fromSet
          ? format.format === 'multi_day'
            ? 'This set is your first entry. Every set you do before the window ends counts too. Only good reps count, and your friend sees your score before they go.'
            : format.format === 'timed'
              ? `This set becomes your attempt: most good reps in ${format.durationS} seconds. Your friend sees your score before they go.`
              : "This set becomes your attempt. Only good reps count — shallow reps don't. Your friend sees your score before they go."
          : format.format === 'timed'
            ? `Most good reps in ${format.durationS} seconds wins. Shallow reps don't count.`
            : `Most good reps in one set wins. A set ends after ${d.maxRepsIdleEndS} s without a rep. Shallow reps don't count.`}
      </Text>

      {format.format === 'multi_day' ? (
        <>
          <SectionTitle>Window</SectionTitle>
          <View style={s.chips}>
            {d.multiDayWindowOptionsDays.map((days) => (
              <Chip key={days} label={windowLabel(days)} on={windowDays === days} onPress={() => setWindowDays(days)} />
            ))}
          </View>
        </>
      ) : (
        <>
          <SectionTitle>Everyone plays within</SectionTitle>
          <View style={s.chips}>
            {options.map((h) => (
              <Chip key={h} label={deadlineLabel(h)} on={hours === h} onPress={() => setHours(h)} />
            ))}
          </View>
        </>
      )}

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
      {offered && offered.length === 0 ? <Text style={s.error}>This set is already in a battle.</Text> : null}
      <Button title={busy ? 'Creating…' : fromSet ? 'Send challenge' : 'Create battle'} onPress={create} />
      {fromSet ? null : (
        <Text style={[s.muted, { marginTop: 8 }]}>After you create it, do your attempt. A set you already finished is not included.</Text>
      )}
    </View>
  );
}
