import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { api } from '../../battles/api';
import type { ChallengeOffer } from '../../battles/challengeFromSet';
import { countedReps } from '../../battles/counting';
import { Friend, friendlyError, personName, type ChallengeKind } from '../../battles/model';
import {
  KIND_TILES,
  canSend,
  formFromRematch,
  initialForm,
  lengthKey,
  lengthOptions,
  newChallengePayload,
  timeLimitLabel,
  withKind,
  withLength,
} from '../../battles/newChallenge';
import { submitBattleAttempt } from '../../battles/uploader';
import { formatCount } from '../../progress';
import type { SessionRecord } from '../../storage/history';
import {
  Avatar,
  Button,
  Card,
  Icon,
  ListGroup,
  ListRow,
  SectionHeader,
  Segmented,
  Text,
  color,
  gutter,
  space,
  type IconName,
} from '../../ui';

const KIND_ICON: Record<ChallengeKind, IconName> = { best_set: 'bolt', total: 'chart', streak: 'flame', team: 'team' };

/** Pick from a short list: native action sheet on iOS, an alert elsewhere. */
function choose<T>(title: string, options: { label: string; value: T }[], onPick: (value: T) => void) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length },
      (i) => (i < options.length ? onPick(options[i].value) : undefined),
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...options.map((o) => ({ text: o.label, onPress: () => onPick(o.value) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

/** New challenge (frame 21, E12), a form sheet: Cancel and title, kind tiles, friends, length, time limit or goal, Send. */
export function NewChallengeSheet({
  friendIds,
  fromSet,
  offer,
  rematchChallengeId,
  hasGoal,
  onNeedGoal,
  onInvite,
  onCreated,
  onCancel,
}: {
  friendIds?: string[];
  /** The set that just finished. A best set with the same timer uses it as the creator's try. */
  fromSet?: SessionRecord;
  offer?: ChallengeOffer;
  /** Load prefilled settings from `rematch_defaults`. */
  rematchChallengeId?: string;
  /** False until this phone has an open daily goal. A streak sends them to set one. */
  hasGoal: boolean;
  onNeedGoal: () => void;
  /** No friends yet (E12): share the app invite. */
  onInvite: () => void;
  onCreated: (
    challengeId: string,
    share: boolean,
    extras?: { promptAttempt?: boolean; justPlayed?: { reps: number; counted: number } },
  ) => void;
  /** Cancel in the sheet's header: close without sending. */
  onCancel: () => void;
}) {
  const { appSettings } = useBackend();
  const { deviceId } = useIdentity();
  const settings = { battle: appSettings.asyncBattleDefaults, streak: appSettings.streakLengths, team: appSettings.teamTargets };
  const maxInvites = appSettings.asyncMaxParticipants - 1;
  const setTimer = fromSet ? (fromSet.timerDurationS ?? null) : undefined;
  const [form, setForm] = useState(() => initialForm(settings, offer, friendIds, setTimer));
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rematchReady, setRematchReady] = useState(!rematchChallengeId);

  useEffect(() => {
    if (!supabase) return;
    api
      .friends(supabase)
      .then((r) => (r.ok ? setFriends(r.data.filter((f) => f.relation === 'friend')) : setError(friendlyError(r.message))));
  }, []);

  useEffect(() => {
    if (!rematchChallengeId || !supabase) return;
    let cancelled = false;
    const s = { battle: appSettings.asyncBattleDefaults, streak: appSettings.streakLengths, team: appSettings.teamTargets };
    api.rematchDefaults(supabase, rematchChallengeId).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setForm(formFromRematch(s, r.data));
      else setError(friendlyError(r.ok ? 'challenge not found' : r.message));
      setRematchReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [rematchChallengeId, appSettings]);

  const toggle = (id: string) =>
    setForm((f) => {
      if (f.friendIds.includes(id)) return { ...f, friendIds: f.friendIds.filter((x) => x !== id) };
      if (f.friendIds.length >= maxInvites) return f;
      return { ...f, friendIds: [...f.friendIds, id] };
    });

  const claimThisSet = !!fromSet && form.kind === 'best_set' && form.durationS === (setTimer ?? null);
  const needsGoal = form.kind === 'streak' && !hasGoal;
  const lengths = lengthOptions(form.kind, settings);
  const noFriends = friends !== null && friends.length === 0;

  const send = async () => {
    if (!supabase || busy || !rematchReady) return;
    if (needsGoal) return onNeedGoal();
    if (!canSend(form)) return;
    setBusy(true);
    setError(null);
    const r = await api.createBattle(supabase, newChallengePayload(form));
    if (!r.ok) {
      setBusy(false);
      return setError(friendlyError(r.message));
    }
    let promptAttempt = form.kind === 'best_set' && !claimThisSet;
    let justPlayed: { reps: number; counted: number } | undefined;
    if (claimThisSet && fromSet) {
      const rules = form.durationS
        ? { format: 'timed' as const, durationS: form.durationS }
        : { format: 'max_reps' as const, durationS: null };
      try {
        const flushed = await submitBattleAttempt(fromSet, r.data.challengeId, deviceId, { linkFinishedSet: true });
        const failed = flushed?.failed.find((f) => f.payload.id === fromSet.id);
        if (failed) {
          promptAttempt = true;
          setError(friendlyError(failed.error));
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
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12} style={styles.cancel}>
          <Text variant="body" tone="secondary">
            Cancel
          </Text>
        </Pressable>
        <Text variant="headline" accessibilityRole="header" align="center" style={styles.title}>
          New challenge
        </Text>
        <View style={styles.cancel} />
      </View>
      {!rematchReady ? (
        <ActivityIndicator color={color.secondary} style={styles.loading} />
      ) : (
      <>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Kind" style={styles.firstSection} />
        <View style={styles.tiles}>
          {KIND_TILES.map((t) => (
            <Card
              key={t.kind}
              elevated
              selected={form.kind === t.kind}
              padding={14}
              style={styles.tile}
              onPress={() => setForm((f) => withKind(f, t.kind, settings.team))}
              accessibilityLabel={`${t.title}, ${t.line}`}
            >
              <Icon name={KIND_ICON[t.kind]} size={20} color={color.label} />
              <Text variant="headline" style={styles.tileTitle}>
                {t.title}
              </Text>
              <Text variant="footnote">{t.line}</Text>
            </Card>
          ))}
        </View>

        <SectionHeader title="Friends" />
        {noFriends ? (
          <ListGroup style={styles.elevated}>
            <ListRow title="Invite friends" leading={<Icon name="share" size={18} color={color.label} />} chevron onPress={onInvite} />
          </ListGroup>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friends}>
            {(friends ?? []).map((f) => {
              const on = form.friendIds.includes(f.userId);
              return (
                <Pressable
                  key={f.userId}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={personName(f)}
                  onPress={() => toggle(f.userId)}
                  style={styles.friend}
                >
                  <View>
                    <Avatar name={personName(f)} size={52} />
                    {on ? (
                      <View style={styles.check}>
                        <Icon name="check" size={11} color={color.bg} />
                      </View>
                    ) : null}
                  </View>
                  <Text variant="footnote" tone="label" numberOfLines={1} style={styles.friendName}>
                    {personName(f)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <SectionHeader title="Length" />
        {lengths.length > 0 ? (
          <Segmented options={lengths} value={lengthKey(form)} onChange={(key) => setForm((f) => withLength(f, key))} />
        ) : null}

        {form.kind === 'best_set' && !noFriends ? (
          <ListGroup style={[styles.elevated, styles.after]}>
            <ListRow
              title="Time limit per set"
              value={timeLimitLabel(form.durationS)}
              chevron
              onPress={() =>
                choose(
                  'Time limit per set',
                  [
                    ...settings.battle.timedDurationsS.map((s) => ({ label: timeLimitLabel(s), value: s as number | null })),
                    { label: 'No limit', value: null },
                  ],
                  (durationS) => setForm((f) => ({ ...f, durationS })),
                )
              }
            />
          </ListGroup>
        ) : null}
        {form.kind === 'team' ? (
          <ListGroup style={[styles.elevated, styles.after]}>
            <ListRow
              title="Goal"
              value={`${formatCount(form.targetReps)} reps`}
              chevron
              onPress={() =>
                choose(
                  'Goal',
                  settings.team.options.map((n) => ({ label: `${formatCount(n)} reps`, value: n })),
                  (targetReps) => setForm((f) => ({ ...f, targetReps })),
                )
              }
            />
          </ListGroup>
        ) : null}

        {claimThisSet ? (
          <Text variant="footnote" style={styles.note}>
            Uses the set you just did.
          </Text>
        ) : null}
        {needsGoal ? (
          <Text variant="footnote" style={styles.note}>
            A streak needs a daily goal first.
          </Text>
        ) : null}
        {error ? (
          <Text variant="footnote" tone="destructive" style={styles.note}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {needsGoal ? (
          <Button title="Set a goal" onPress={onNeedGoal} />
        ) : canSend(form) ? (
          <Button title="Send challenge" loading={busy} onPress={send} />
        ) : (
          // Off until a friend is picked (E12): gray with dim text, as in the mockup.
          <View accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.sendOff}>
            <Text variant="headline" tone="tertiary">
              Send challenge
            </Text>
          </View>
        )}
      </View>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  header: { height: 44, marginTop: 18, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center' },
  cancel: { width: 72 },
  title: { flex: 1, fontSize: 18 },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  firstSection: { marginTop: space.xs },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tile: { flexBasis: '47%', flexGrow: 1 },
  tileTitle: { fontSize: 15, marginTop: 10 },
  friends: { gap: 14, paddingHorizontal: space.xxs },
  friend: { alignItems: 'center', width: 56 },
  check: {
    position: 'absolute',
    right: -2,
    top: 34,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.label,
    borderWidth: 2,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendName: { marginTop: 6 },
  elevated: { backgroundColor: color.elevated },
  after: { marginTop: space.sm },
  note: { marginTop: 10, marginHorizontal: space.xxs },
  sendOff: { height: 56, borderRadius: 999, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
  loading: { flex: 1, marginTop: space.xl },
});
