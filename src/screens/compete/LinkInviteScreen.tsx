import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { api } from '../../battles/api';
import { challengeName, kindLabel, lengthLabel } from '../../battles/challengeView';
import { friendlyError, InvitePreview, personName } from '../../battles/model';
import { formatCount, formatDeadline } from '../../progress';
import { Avatar, Button, EmptyState, ListGroup, ListRow, SectionHeader, Text, color, gutter, space } from '../../ui';

const PROBLEM: Record<string, string> = {
  not_found: "This invite link doesn't exist.",
  revoked: 'This invite link was turned off.',
  closed: 'This challenge is over.',
  expired: 'This invite has expired.',
  used_up: 'This invite link has been used up.',
  full: 'This challenge is full.',
};

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Someone opened a challenge link: what it is, and Join (frame 24 layout). Works signed out to preview. */
export function LinkInviteScreen(props: {
  token: string;
  onJoined: (battleId: string, promptNotifications?: boolean) => void;
  onAccount: () => void;
  onProfile: () => void;
  hasGoal: boolean;
  onNeedGoal: () => void;
}) {
  const { token, onJoined, hasGoal, onNeedGoal } = props;
  const { session } = useBackend();
  const { profile } = useIdentity();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addFriend, setAddFriend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!supabase) return;
    // Works signed out too, so people can see what they're joining before signing in.
    api.invitePreview(supabase, token).then((r) => (r.ok ? setPreview(r.data) : setError(friendlyError(r.message))));
  }, [token, session?.user.id]);

  const join = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const r = await api.redeemInvite(supabase, token, addFriend);
    setBusy(false);
    if (!r.ok) return setError(friendlyError(r.message));
    api.kickNotify(supabase);
    // Landing on the challenge should show the notification sheet (once) before the first set.
    onJoined(r.data, true);
  };

  if (!preview) {
    return (
      <View style={styles.root}>
        {error ? (
          <EmptyState icon="info" title="Couldn't open this invite" message={error} />
        ) : (
          <ActivityIndicator style={styles.loading} color={color.secondary} />
        )}
      </View>
    );
  }
  const c = preview.challenge;
  if (!c || (preview.status !== 'ok' && !preview.member)) {
    return (
      <View style={styles.root}>
        <EmptyState icon="info" title="Can't join" message={PROBLEM[preview.status] ?? 'This invite is not available.'} />
      </View>
    );
  }

  const from = preview.creator ? personName(preview.creator) : 'A friend';
  const shape = { kind: c.kind, windowUnit: c.windowUnit ?? null, startsAt: c.startsAt ?? null, endsAt: c.endsAt };
  const length = lengthLabel(shape);
  const isSelf = !!preview.creator && preview.creator.username === profile?.username;
  const needsGoal = c.kind === 'streak' && !hasGoal;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Avatar name={from} size={72} />
          <Text variant="title2" align="center" style={styles.title}>
            {`${from} challenged you`}
          </Text>
          <Text variant="body" tone="secondary" align="center" style={styles.sub}>
            {challengeName(shape)}
          </Text>
        </View>
        <ListGroup style={styles.group}>
          <ListRow title="Kind" value={kindLabel(c)} />
          <ListRow title="Players" value={`${c.players} of ${c.maxParticipants}`} />
          {c.kind === 'best_set' && c.durationS ? <ListRow title="Time limit" value={`${c.durationS} s`} /> : null}
          {length ? <ListRow title="Length" value={length} /> : null}
          {c.kind === 'team' && c.targetReps ? <ListRow title="Goal" value={`${formatCount(c.targetReps)} reps`} /> : null}
          {c.endsAt ? <ListRow title="Ends" value={formatDeadline(c.endsAt, now, timeZone())} /> : null}
        </ListGroup>
        {preview.scores?.length ? (
          <>
            <SectionHeader title="Scores so far" />
            <ListGroup>
              {preview.scores.map((x, i) => (
                <ListRow key={i} title={personName(x)} value={formatCount(x.validReps ?? Math.round(x.metricValue ?? 0))} />
              ))}
            </ListGroup>
          </>
        ) : null}
        {session && profile && !preview.member && preview.creator && !isSelf ? (
          <ListGroup style={styles.friendGroup}>
            <ListRow title={`Add ${from} as a friend`} switchValue={addFriend} onSwitchChange={setAddFriend} />
          </ListGroup>
        ) : null}
        {needsGoal && !preview.member ? (
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
        {!session ? (
          <Button title="Sign in to join" onPress={props.onAccount} />
        ) : profile === undefined ? (
          <ActivityIndicator color={color.secondary} />
        ) : profile === null ? (
          <Button title="Pick a username" onPress={props.onProfile} />
        ) : preview.member ? (
          <Button title="Open challenge" onPress={() => onJoined(c.id)} />
        ) : needsGoal ? (
          <Button title="Set a goal" onPress={onNeedGoal} />
        ) : (
          <Button title="Join challenge" loading={busy} onPress={join} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  loading: { marginTop: 48 },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  head: { alignItems: 'center', marginTop: 40 },
  title: { marginTop: space.md },
  sub: { marginTop: 6 },
  group: { marginTop: 28 },
  friendGroup: { marginTop: space.md },
  note: { marginTop: 10, marginHorizontal: space.xxs },
  footer: { paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
});
