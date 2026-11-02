import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import { ChallengeOffer, offerLabel, windowClosingNote } from '../../battles/challengeFromSet';
import { countedReps } from '../../battles/counting';
import { Friend, friendlyError, personName } from '../../battles/model';
import { submitBattleAttempt } from '../../battles/uploader';
import { deviceTimeZone } from '../../backend/profile';
import { SessionRecord } from '../../storage/history';
import { AccountGate, Chip, Header, Row, s, SectionTitle } from './common';

type Metric = 'rep_count' | 'depth_consistency' | 'tempo' | 'form_score';

export function deadlineLabel(h: number): string {
  if (h % 24 === 0) return h === 24 ? '1 day' : `${h / 24} days`;
  return `${h} hours`;
}

export function NewBattleScreen(props: {
  friendIds?: string[];
  /** The set that just finished. Best single set claims it; a window does not. */
  fromSet?: SessionRecord;
  offer?: ChallengeOffer;
  onBack: () => void;
  onCreated: (
    challengeId: string,
    share: boolean,
    extras?: { promptAttempt?: boolean; justPlayed?: { reps: number; counted: number } },
  ) => void;
  onFriends: () => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
      <Header title="New challenge" onBack={props.onBack} />
      <AccountGate onAccount={props.onAccount} onProfile={props.onProfile} why="Challenges are with friends, so you need an account.">
        <Form {...props} />
      </AccountGate>
    </ScrollView>
  );
}

function Form({
  friendIds,
  fromSet,
  offer,
  onCreated,
  onFriends,
}: {
  friendIds?: string[];
  fromSet?: SessionRecord;
  offer?: ChallengeOffer;
  onCreated: (id: string, share: boolean, extras?: { promptAttempt?: boolean; justPlayed?: { reps: number; counted: number } }) => void;
  onFriends: () => void;
}) {
  const { appSettings } = useBackend();
  const { deviceId } = useIdentity();
  const d = appSettings.asyncBattleDefaults;
  const maxInvites = appSettings.asyncMaxParticipants - 1;
  const [choice, setChoice] = useState<ChallengeOffer>(offer ?? { kind: 'best_set', durationS: null });
  const [metric, setMetric] = useState<Metric>('rep_count');
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

  const options = [...new Set([...d.deadlineOptionsHours, d.deadlineHours])].filter((h) => h <= d.maxDeadlineHours).sort((a, b) => a - b);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < maxInvites) n.add(id);
      return n;
    });

  const setTimer = fromSet?.timerDurationS ?? null;
  const claimThisSet = !!fromSet && choice.kind === 'best_set' && (choice.durationS ?? null) === setTimer;
  const closing = choice.kind === 'total' ? windowClosingNote(choice.window, Date.now(), deviceTimeZone()) : null;

  const create = async () => {
    if (!supabase || busy) return;
    if (!picked.size && !link) return setError('Pick a friend or turn on the invite link.');
    setBusy(true);
    setError(null);
    const r = await api.createBattle(supabase, {
      kind: choice.kind,
      metric: choice.kind === 'best_set' && !choice.durationS ? metric : undefined,
      durationS: choice.kind === 'best_set' ? choice.durationS ?? undefined : undefined,
      deadlineHours: choice.kind === 'best_set' ? hours : undefined,
      window: choice.kind === 'total' ? choice.window : undefined,
      friendIds: [...picked],
      inviteLink: link,
    });
    if (!r.ok) {
      setBusy(false);
      return setError(friendlyError(r.message));
    }
    let promptAttempt = choice.kind === 'best_set' && !claimThisSet;
    let justPlayed: { reps: number; counted: number } | undefined;
    if (claimThisSet && fromSet) {
      const rules = choice.durationS ? { format: 'timed' as const, durationS: choice.durationS } : { format: 'max_reps' as const, durationS: null };
      try {
        const flushed = await submitBattleAttempt(fromSet, r.data.challengeId, deviceId, { linkFinishedSet: true });
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
    onCreated(r.data.challengeId, !!r.data.inviteToken, { promptAttempt, justPlayed });
  };

  return (
    <View>
      <SectionTitle>Kind</SectionTitle>
      <View style={s.chips}>
        <Chip label="Best single set" on={choice.kind === 'best_set'} onPress={() => setChoice({ kind: 'best_set', durationS: null })} />
        <Chip label="Most reps" on={choice.kind === 'total'} onPress={() => setChoice({ kind: 'total', window: 'day' })} />
      </View>

      {choice.kind === 'best_set' ? (
        <>
          <SectionTitle>Timer</SectionTitle>
          <View style={s.chips}>
            <Chip label="Untimed" on={choice.durationS == null} onPress={() => setChoice({ kind: 'best_set', durationS: null })} />
            {d.timedDurationsS.map((t) => (
              <Chip key={t} label={t % 60 === 0 ? `${t / 60} min` : `${t} s`} on={choice.durationS === t} onPress={() => setChoice({ kind: 'best_set', durationS: t })} />
            ))}
          </View>
          {choice.durationS == null && !fromSet ? (
            <>
              <SectionTitle>What wins</SectionTitle>
              <View style={s.chips}>
                {(
                  [
                    ['rep_count', 'Reps'],
                    ['depth_consistency', 'Depth'],
                    ['tempo', 'Tempo'],
                    ['form_score', 'Form'],
                  ] as const
                ).map(([id, label]) => (
                  <Chip key={id} label={label} on={metric === id} onPress={() => setMetric(id)} />
                ))}
              </View>
            </>
          ) : null}
          <SectionTitle>Everyone plays within</SectionTitle>
          <View style={s.chips}>
            {options.map((h) => (
              <Chip key={h} label={deadlineLabel(h)} on={hours === h} onPress={() => setHours(h)} />
            ))}
          </View>
          <Text style={s.muted}>
            {claimThisSet
              ? "We'll use the set you just did."
              : choice.durationS
                ? `Most good reps in ${choice.durationS} seconds wins. Shallow reps don't count.`
                : `Most good reps in one set wins. A set ends after ${d.maxRepsIdleEndS} s without a rep. Shallow reps don't count.`}
          </Text>
        </>
      ) : (
        <>
          <SectionTitle>Window</SectionTitle>
          <View style={s.chips}>
            <Chip label="Today" on={choice.window === 'day'} onPress={() => setChoice({ kind: 'total', window: 'day' })} />
            <Chip label="This week" on={choice.window === 'week'} onPress={() => setChoice({ kind: 'total', window: 'week' })} />
            <Chip label="This month" on={choice.window === 'month'} onPress={() => setChoice({ kind: 'total', window: 'month' })} />
          </View>
          <Text style={s.muted}>Every set before the window ends counts, including sets you already did. Shallow reps don't count.</Text>
          {closing ? <Text style={s.muted}>{closing}</Text> : null}
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
      {!picked.size && !link ? <Text style={s.muted}>Pick at least one friend or turn on the invite link.</Text> : null}
      <Button title={busy ? 'Creating…' : 'Create challenge'} onPress={create} />
      {fromSet ? <Text style={[s.muted, { marginTop: 8 }]}>{offerLabel(choice)}</Text> : null}
    </View>
  );
}
