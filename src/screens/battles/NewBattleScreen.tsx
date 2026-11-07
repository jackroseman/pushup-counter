import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import { ChallengeOffer, offerLabel, windowClosingNote } from '../../battles/challengeFromSet';
import { countedReps } from '../../battles/counting';
import { ChallengeKind, Friend, friendlyError, personName } from '../../battles/model';
import { submitBattleAttempt } from '../../battles/uploader';
import { deviceTimeZone } from '../../backend/profile';
import { SessionRecord } from '../../storage/history';
import { AccountGate, Chip, Header, Row, s, SectionTitle } from './common';

type Metric = 'rep_count' | 'depth_consistency' | 'tempo' | 'form_score';
type WindowChoice = 'day' | 'week' | 'month' | 'custom';

function wholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

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
  /** False until this phone has an open daily goal. Streak create sends them to set one. */
  hasGoal: boolean;
  onNeedGoal: () => void;
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
  hasGoal,
  onNeedGoal,
}: {
  friendIds?: string[];
  fromSet?: SessionRecord;
  offer?: ChallengeOffer;
  onCreated: (id: string, share: boolean, extras?: { promptAttempt?: boolean; justPlayed?: { reps: number; counted: number } }) => void;
  onFriends: () => void;
  hasGoal: boolean;
  onNeedGoal: () => void;
}) {
  const { appSettings } = useBackend();
  const { deviceId } = useIdentity();
  const d = appSettings.asyncBattleDefaults;
  const lengths = appSettings.streakLengths;
  const targets = appSettings.teamTargets;
  const maxInvites = appSettings.asyncMaxParticipants - 1;
  const [kind, setKind] = useState<ChallengeKind>(offer?.kind ?? 'best_set');
  const [durationS, setDurationS] = useState<number | null>(offer?.kind === 'best_set' ? offer.durationS : null);
  const [windowUnit, setWindowUnit] = useState<WindowChoice>(offer?.kind === 'total' ? offer.window : targets.defaultWindow);
  const [metric, setMetric] = useState<Metric>('rep_count');
  const [hours, setHours] = useState(d.deadlineHours);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(friendIds ?? []));
  const [link, setLink] = useState(!(friendIds && friendIds.length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customHours, setCustomHours] = useState('24');
  const [streakChoice, setStreakChoice] = useState<number | 'custom'>(lengths.optionsDays[0] ?? 7);
  const [customStreak, setCustomStreak] = useState(String(lengths.minDays));
  const [targetChoice, setTargetChoice] = useState<number | 'custom'>(
    targets.options.includes(targets.defaultTarget) ? targets.defaultTarget : 'custom',
  );
  const [customTarget, setCustomTarget] = useState(String(targets.defaultTarget));

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
  const claimThisSet = !!fromSet && kind === 'best_set' && (durationS ?? null) === setTimer;
  const closing =
    (kind === 'total' || kind === 'team') && windowUnit !== 'custom' ? windowClosingNote(windowUnit, Date.now(), deviceTimeZone()) : null;
  const maxCustomHours = appSettings.challengeCustomMaxDays * 24;
  const streakDays = streakChoice === 'custom' ? wholeNumber(customStreak, lengths.minDays, lengths.maxDays) : streakChoice;
  const teamTarget = targetChoice === 'custom' ? wholeNumber(customTarget, targets.min, targets.max) : targetChoice;
  const customSpan = wholeNumber(customHours, 1, maxCustomHours);
  const needsGoal = kind === 'streak' && !hasGoal;

  const create = async () => {
    if (!supabase || busy) return;
    if (needsGoal) return onNeedGoal();
    if (!picked.size && !link) return setError('Pick a friend or turn on the invite link.');
    if (kind === 'streak' && streakDays == null) {
      return setError(`A streak face-off is ${lengths.minDays} to ${lengths.maxDays} days.`);
    }
    if (kind === 'team' && teamTarget == null) {
      return setError(`The shared goal is ${targets.min} to ${targets.max} reps.`);
    }
    if ((kind === 'total' || kind === 'team') && windowUnit === 'custom' && customSpan == null) {
      return setError(`A custom window is 1 hour to ${appSettings.challengeCustomMaxDays} days, starting now.`);
    }
    setBusy(true);
    setError(null);
    const now = Date.now();
    const r = await api.createBattle(supabase, {
      kind,
      metric: kind === 'best_set' && !durationS ? metric : undefined,
      durationS: kind === 'best_set' ? durationS ?? undefined : undefined,
      deadlineHours: kind === 'best_set' ? hours : undefined,
      window: kind === 'total' || kind === 'team' ? windowUnit : undefined,
      customStartsAt: windowUnit === 'custom' && (kind === 'total' || kind === 'team') ? new Date(now).toISOString() : undefined,
      customEndsAt:
        windowUnit === 'custom' && (kind === 'total' || kind === 'team') && customSpan != null
          ? new Date(now + customSpan * 3_600_000).toISOString()
          : undefined,
      streakDays: kind === 'streak' && streakDays != null ? streakDays : undefined,
      targetReps: kind === 'team' && teamTarget != null ? teamTarget : undefined,
      friendIds: [...picked],
      inviteLink: link,
    });
    if (!r.ok) {
      setBusy(false);
      return setError(friendlyError(r.message));
    }
    let promptAttempt = kind === 'best_set' && !claimThisSet;
    let justPlayed: { reps: number; counted: number } | undefined;
    if (claimThisSet && fromSet) {
      const rules = durationS ? { format: 'timed' as const, durationS } : { format: 'max_reps' as const, durationS: null };
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
        <Chip label="Best single set" on={kind === 'best_set'} onPress={() => setKind('best_set')} />
        <Chip label="Most reps" on={kind === 'total'} onPress={() => { setKind('total'); setWindowUnit('day'); }} />
        <Chip label="Streak face-off" on={kind === 'streak'} onPress={() => setKind('streak')} />
        <Chip label="Team goal" on={kind === 'team'} onPress={() => { setKind('team'); setWindowUnit(targets.defaultWindow); }} />
      </View>

      {kind === 'best_set' ? (
        <>
          <SectionTitle>Timer</SectionTitle>
          <View style={s.chips}>
            <Chip label="Untimed" on={durationS == null} onPress={() => setDurationS(null)} />
            {d.timedDurationsS.map((t) => (
              <Chip key={t} label={t % 60 === 0 ? `${t / 60} min` : `${t} s`} on={durationS === t} onPress={() => setDurationS(t)} />
            ))}
          </View>
          {durationS == null && !fromSet ? (
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
              : durationS
                ? `Most good reps in ${durationS} seconds wins. Shallow reps don't count.`
                : `Most good reps in one set wins. A set ends after ${d.maxRepsIdleEndS} s without a rep. Shallow reps don't count.`}
          </Text>
        </>
      ) : null}

      {kind === 'streak' ? (
        <>
          <SectionTitle>How long</SectionTitle>
          <View style={s.chips}>
            {lengths.optionsDays.map((days) => (
              <Chip key={days} label={`${days} days`} on={streakChoice === days} onPress={() => setStreakChoice(days)} />
            ))}
            <Chip label="Custom" on={streakChoice === 'custom'} onPress={() => setStreakChoice('custom')} />
          </View>
          {streakChoice === 'custom' ? (
            <TextInput
              style={[s.input, { marginBottom: 8 }]}
              keyboardType="number-pad"
              value={customStreak}
              onChangeText={setCustomStreak}
              placeholder={`${lengths.minDays} to ${lengths.maxDays} days`}
              placeholderTextColor={colors.muted}
            />
          ) : null}
          <Text style={s.muted}>
            Who keeps hitting their daily goal the longest. The bar freezes when each person joins. A program rest day is not a free pass.
            {needsGoal ? ' Set a daily goal first.' : ''}
          </Text>
        </>
      ) : null}

      {kind === 'total' || kind === 'team' ? (
        <>
          <SectionTitle>Window</SectionTitle>
          <View style={s.chips}>
            <Chip label="Today" on={windowUnit === 'day'} onPress={() => setWindowUnit('day')} />
            <Chip label="This week" on={windowUnit === 'week'} onPress={() => setWindowUnit('week')} />
            <Chip label="This month" on={windowUnit === 'month'} onPress={() => setWindowUnit('month')} />
            <Chip label="Custom" on={windowUnit === 'custom'} onPress={() => setWindowUnit('custom')} />
          </View>
          {windowUnit === 'custom' ? (
            <TextInput
              style={[s.input, { marginBottom: 8 }]}
              keyboardType="number-pad"
              value={customHours}
              onChangeText={setCustomHours}
              placeholder={`Hours from now, up to ${appSettings.challengeCustomMaxDays} days`}
              placeholderTextColor={colors.muted}
            />
          ) : null}
          {kind === 'team' ? (
            <>
              <SectionTitle>Shared goal</SectionTitle>
              <View style={s.chips}>
                {targets.options.map((n) => (
                  <Chip key={n} label={String(n)} on={targetChoice === n} onPress={() => setTargetChoice(n)} />
                ))}
                <Chip label="Custom" on={targetChoice === 'custom'} onPress={() => setTargetChoice('custom')} />
              </View>
              {targetChoice === 'custom' ? (
                <TextInput
                  style={[s.input, { marginBottom: 8 }]}
                  keyboardType="number-pad"
                  value={customTarget}
                  onChangeText={setCustomTarget}
                  placeholder={`${targets.min} to ${targets.max}`}
                  placeholderTextColor={colors.muted}
                />
              ) : null}
              <Text style={s.muted}>Everyone's sets count toward one number. You win together when it hits the goal. Shallow reps don't count.</Text>
            </>
          ) : (
            <Text style={s.muted}>Every set before the window ends counts, including sets you already did. Shallow reps don't count.</Text>
          )}
          {windowUnit === 'custom' ? (
            <Text style={s.muted}>A custom window starts now and runs for the number of hours you type.</Text>
          ) : null}
          {closing ? <Text style={s.muted}>{closing}</Text> : null}
        </>
      ) : null}

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
      <Button title={needsGoal ? 'Set a daily goal' : busy ? 'Creating…' : 'Create challenge'} onPress={needsGoal ? onNeedGoal : create} />
      {fromSet ? (
        <Text style={[s.muted, { marginTop: 8 }]}>
          {offerLabel(
            kind === 'best_set'
              ? { kind, durationS }
              : kind === 'total' && windowUnit !== 'custom'
                ? { kind, window: windowUnit }
                : kind === 'streak'
                  ? { kind: 'streak' }
                  : kind === 'team'
                    ? { kind: 'team' }
                    : { kind: 'total', window: 'week' },
          )}
        </Text>
      ) : null}
    </View>
  );
}
