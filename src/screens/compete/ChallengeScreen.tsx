import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { api } from '../../battles/api';
import type { OpenChallenge } from '../../battles/openChallenges';
import { rememberBattles, rememberedBattle } from '../../battles/battleCache';
import {
  canAddReps,
  challengeName,
  detailLine,
  headScore,
  headToHead,
  kindLabel,
  lengthLabel,
  resultOf,
  resultSubtitle,
  standings,
  teamProgress,
  type StandingRow,
} from '../../battles/challengeView';
import {
  Battle,
  canPlay,
  canRespond,
  creatorAttemptCue,
  friendlyError,
  inviteShareMessage,
  inviteUrl,
  isOpen,
  me,
  personName,
} from '../../battles/model';
import { flushBattleUploads, onBattleUploads } from '../../battles/uploader';
import { loadBattleQueue } from '../../battles/uploadQueue';
import { ChallengeNotifications, NotificationOptInBanner } from '../../components/NotificationPrompt';
import { formatCount, formatDeadline } from '../../progress';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  ListGroup,
  ListRow,
  ProgressBar,
  SectionHeader,
  Text,
  color,
  gutter,
  hero,
  space,
} from '../../ui';

export type ChallengeMenuItem = { label: string; destructive?: boolean; onPress: () => void };

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function seededBattle(battleId: string, initialBattle?: Battle): Battle | undefined {
  if (initialBattle?.id === battleId) return initialBattle;
  return rememberedBattle(battleId);
}

/**
 * One challenge (frames 23, 24, 25): your move / in progress, an invite to answer, or the result.
 * The header title and the ••• menu are handed to the route through `onHeader`.
 */
export function ChallengeScreen({
  battleId,
  initialBattle,
  share,
  justPlayed,
  promptAttempt,
  promptNotifications,
  hasGoal,
  onNeedGoal,
  onPlay,
  onStartSet,
  onRematch,
  onClosed,
  onHeader,
}: {
  battleId: string;
  /** Challenge row already loaded by the list, so the screen can paint immediately. */
  initialBattle?: Battle;
  share?: boolean;
  justPlayed?: { reps: number; counted: number; phoneMoved?: boolean };
  /** Plain create flow: the creator has not played yet. */
  promptAttempt?: boolean;
  /** Just created this challenge or joined it from an invite link. */
  promptNotifications?: boolean;
  /** Open daily goal on this phone. A streak invite without one goes to the goal sheet. */
  hasGoal: boolean;
  onNeedGoal: () => void;
  onPlay: (b: Battle) => void;
  onStartSet: () => void;
  onRematch: (b: Battle) => void;
  /** After cancelling: leave the screen. */
  onClosed: () => void;
  onHeader: (header: { title: string; menu: ChallengeMenuItem[] }) => void;
}) {
  const { appSettings } = useBackend();
  const { profile } = useIdentity();
  const [b, setB] = useState<Battle | null | undefined>(() => seededBattle(battleId, initialBattle));
  const [trackedId, setTrackedId] = useState(battleId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<{ pending: boolean; failed: string | null }>({ pending: false, failed: null });
  const [justActed, setJustActed] = useState(!!promptNotifications);
  const [now, setNow] = useState(() => Date.now());
  const [openRow, setOpenRow] = useState<OpenChallenge | null>(null);
  const shared = useRef(false);
  const loadSeq = useRef(0);
  const inFlight = useRef(0);
  if (trackedId !== battleId) {
    setTrackedId(battleId);
    setB(seededBattle(battleId, initialBattle));
    setError(null);
    setJustActed(!!promptNotifications);
  }

  const load = useCallback(async () => {
    if (!supabase) return;
    const ticket = ++loadSeq.current;
    inFlight.current += 1;
    try {
      const q = await loadBattleQueue(AsyncStorage);
      if (ticket !== loadSeq.current) return;
      setQueued({
        pending: q.pending.some((x) => x.challengeId === battleId),
        failed: q.failed.filter((x) => x.challengeId === battleId).pop()?.error ?? null,
      });
      const [r, o] = await Promise.all([api.battle(supabase, battleId), api.myOpenChallenges(supabase)]);
      if (ticket !== loadSeq.current) return;
      setNow(Date.now());
      if (o.ok) setOpenRow((o.data ?? []).find((row) => row.challengeId === battleId) ?? null);
      if (r.ok) {
        setB(r.data);
        setError(null);
        if (r.data) rememberBattles([r.data]);
      } else setError(friendlyError(r.message));
    } finally {
      inFlight.current = Math.max(0, inFlight.current - 1);
    }
  }, [battleId]);

  useFocusEffect(
    useCallback(() => {
      flushBattleUploads().catch(() => {});
      load();
    }, [load]),
  );
  useEffect(() => onBattleUploads(() => load()), [load]);
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as { challengeId?: string; battleId?: string };
      if (data?.challengeId === battleId || data?.battleId === battleId) load();
    });
    return () => sub.remove();
  }, [battleId, load]);
  // Standings move while others play; refresh every 20 s while open. Skip a tick while a load runs.
  const open = !!b && isOpen(b);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (inFlight.current > 0) return;
      load();
    }, 20_000);
    return () => clearInterval(t);
  }, [open, load]);

  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
      setBusy(true);
      const r = await fn();
      setBusy(false);
      if (!r.ok) setError(friendlyError(r.message));
      else if (supabase) api.kickNotify(supabase);
      await load();
      return r.ok;
    },
    [load],
  );

  const shareLink = useCallback(
    async (battle: Battle) => {
      if (!supabase) return;
      let token = battle.inviteLinks[0]?.token;
      if (!token) {
        const r = await api.createInviteLink(supabase, battle.id);
        if (!r.ok) return setError(friendlyError(r.message));
        token = r.data;
        load();
      }
      const url = inviteUrl(token, appSettings.inviteLinks);
      const from = profile?.displayName?.trim() || (profile ? `@${profile.username}` : 'A friend');
      await Share.share({ message: inviteShareMessage(battle, from, url) }).catch(() => {});
    },
    [appSettings.inviteLinks, profile, load],
  );

  useEffect(() => {
    if (share && b && !shared.current && b.createdBy === profile?.id && isOpen(b)) {
      shared.current = true;
      shareLink(b);
    }
  }, [share, b, profile?.id, shareLink]);

  // Header: "Invite" while answering, "Result" once over, else the kind. ••• for the creator's actions.
  const invited = !!b && (openRow?.needsResponse ?? canRespond(b, now));
  const over = !!b && !isOpen(b);
  const isCreator = !!b && b.createdBy === profile?.id;
  useLayoutEffect(() => {
    if (!b) return onHeader({ title: '', menu: [] });
    const menu: ChallengeMenuItem[] = [];
    if (isCreator && isOpen(b)) {
      menu.push({ label: 'Share invite link', onPress: () => shareLink(b) });
      for (const link of b.inviteLinks) {
        menu.push({ label: 'Turn off invite link', onPress: () => run(() => api.revokeInviteLink(supabase!, link.token)) });
      }
    }
    if (isCreator && b.status === 'pending') {
      menu.push({
        label: 'Cancel challenge',
        destructive: true,
        onPress: () =>
          Alert.alert('Cancel this challenge?', 'Everyone in it will see it was cancelled.', [
            { text: 'Keep it', style: 'cancel' },
            {
              text: 'Cancel challenge',
              style: 'destructive',
              onPress: async () => (await run(() => api.cancelBattle(supabase!, b.id))) && onClosed(),
            },
          ]),
      });
    } else if (me(b)?.status === 'accepted' && isOpen(b)) {
      menu.push({
        label: 'Leave challenge',
        destructive: true,
        onPress: () =>
          Alert.alert('Leave this challenge?', 'Your score will count as a forfeit.', [
            { text: 'Stay', style: 'cancel' },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: async () => (await run(() => api.leaveBattle(supabase!, b.id))) && onClosed(),
            },
          ]),
      });
    }
    onHeader({ title: invited ? 'Invite' : over ? 'Result' : kindLabel(b), menu });
  }, [b, invited, over, isCreator, onHeader, shareLink, run, onClosed, openRow]);

  const notifications = <ChallengeNotifications justActed={justActed} onConsumed={() => setJustActed(false)} />;
  const optInBanner = <NotificationOptInBanner style={styles.top} />;

  if (b === undefined) {
    return (
      <View style={styles.root}>
        {error ? (
          <EmptyState icon="info" title="Couldn't load this challenge" message={error} />
        ) : (
          <ActivityIndicator style={styles.loading} color={color.secondary} />
        )}
      </View>
    );
  }
  if (b === null) {
    return (
      <View style={styles.root}>
        <EmptyState icon="info" title="Challenge not found" message="It may have been removed." />
      </View>
    );
  }

  const tz = timeZone();
  const mine = me(b);
  const errorLine = error ? (
    <Text variant="footnote" tone="destructive" style={styles.error}>
      {error}
    </Text>
  ) : null;

  // ---- Invite (frame 24) -----------------------------------------------------------------
  if (invited) {
    const creator = b.participants.find((p) => p.userId === b.createdBy) ?? b.participants.find((p) => !p.isMe) ?? null;
    const who = creator ? personName(creator) : 'A friend';
    const people = [
      ...(creator ? [creator] : []),
      ...b.participants.filter((p) => p.isMe),
      ...b.participants.filter((p) => !p.isMe && p !== creator && (p.status === 'accepted' || p.status === 'invited')),
    ];
    const needsGoal = b.kind === 'streak' && !hasGoal;
    const respond = (accept: boolean) => {
      if (busy || !profile) return;
      if (accept && needsGoal) return onNeedGoal();
      void run(() => api.respond(supabase!, b.id, profile.id, accept)).then((ok) => {
        if (ok && accept) setJustActed(true);
      });
    };
    return (
      <View style={styles.root}>
        {notifications}
        <ScrollView contentContainerStyle={styles.content}>
          {optInBanner}
          <View style={styles.inviteHead}>
            <Avatar name={who} size={72} />
            <Text variant="title2" align="center" style={styles.inviteTitle}>
              {`${who} challenged you`}
            </Text>
            <Text variant="body" tone="secondary" align="center" style={styles.inviteSub}>
              {challengeName(b)}
            </Text>
          </View>
          <ListGroup style={styles.inviteGroup}>
            <ListRow title="Kind" value={kindLabel(b)} />
            <ListRow title="Players" value={people.map((p) => (p.isMe ? 'You' : personName(p))).join(', ')} />
            {b.kind === 'best_set' && b.durationS ? <ListRow title="Time limit" value={`${b.durationS} s`} /> : null}
            {lengthLabel(b) ? <ListRow title="Length" value={lengthLabel(b)!} /> : null}
            {b.kind === 'team' && teamProgress(b).target > 0 ? (
              <ListRow title="Goal" value={`${formatCount(teamProgress(b).target)} reps`} />
            ) : null}
            <ListRow title="Starts" value={b.startsAt ? formatDeadline(b.startsAt, now, tz) : 'When you accept'} />
          </ListGroup>
          {b.kind === 'total' || b.kind === 'team' ? (
            <Text variant="footnote" style={styles.note}>
              Every set you do counts.
            </Text>
          ) : null}
          {needsGoal ? (
            <Text variant="footnote" style={styles.note}>
              A streak needs a daily goal first.
            </Text>
          ) : null}
          {errorLine}
        </ScrollView>
        <View style={styles.footerRow}>
          <Button title="Decline" kind="gray" style={styles.flex} disabled={busy} onPress={() => respond(false)} />
          <Button title={needsGoal ? 'Set a goal' : 'Accept'} style={styles.flex} loading={busy} onPress={() => respond(true)} />
        </View>
      </View>
    );
  }

  // ---- Result (frame 25) -----------------------------------------------------------------
  if (over) {
    const result = resultOf(b);
    const completed = b.status === 'completed';
    const showcase = result.winner ?? mine;
    const crowned = completed && (result.kind === 'won' || result.kind === 'lost' || result.kind === 'goal');
    const title = b.myOutcomeLabel || (b.status === 'cancelled' ? 'Cancelled' : b.status === 'expired' ? 'Ended early' : result.title);
    const rows = standings(b);
    const team = b.kind === 'team' ? teamProgress(b) : null;
    return (
      <View style={styles.root}>
        {notifications}
        <ScrollView contentContainerStyle={styles.content}>
          {optInBanner}
          <View style={styles.resultHead}>
            {crowned ? <Icon name="crown" size={22} color={color.label} /> : <View style={styles.crownSpace} />}
            <View style={styles.resultAvatar}>
              <Avatar name={showcase ? personName(showcase) : 'You'} me={!showcase || showcase.isMe} size={76} />
            </View>
            <Text variant="title1" align="center" style={styles.resultTitle}>
              {title}
            </Text>
            <Text variant="body" tone="secondary" align="center" style={styles.resultSub}>
              {resultSubtitle(b, now, tz)}
            </Text>
          </View>
          {team ? (
            <>
              <ListGroup style={styles.resultGroup}>
                <ListRow
                  title="Team total"
                  value={team.target > 0 ? `${formatCount(team.total)} of ${formatCount(team.target)}` : formatCount(team.total)}
                />
              </ListGroup>
              <SectionHeader title="Your part" />
              <ListGroup>
                {rows.map((r) => (
                  <ListRow key={r.userId} title={r.name} value={r.score} />
                ))}
              </ListGroup>
            </>
          ) : (
            <ListGroup style={styles.resultGroup}>
              {rows.map((r) => (
                <StandingLine key={r.userId} row={r} size={20} />
              ))}
            </ListGroup>
          )}
          {errorLine}
        </ScrollView>
        {completed && b.participants.some((p) => !p.isMe) ? (
          <View style={styles.footer}>
            <Button title="Rematch" onPress={() => onRematch(b)} />
          </View>
        ) : null}
      </View>
    );
  }

  // ---- Your move / in progress (frame 23) ------------------------------------------------
  const cue = creatorAttemptCue({
    promptAttempt,
    justPlayed: !!justPlayed,
    attemptsUsed: mine?.attemptsUsed ?? 0,
    uploadPending: queued.pending,
    canPlay: openRow?.ctaType === 'play' || canPlay(b, now),
  });
  const duel = headToHead(b);
  const line = detailLine(b, now);
  const team = b.kind === 'team' ? teamProgress(b) : null;
  const playable = ((openRow ? openRow.ctaType === 'play' : canPlay(b, now))) && !queued.pending;
  const counting = openRow ? openRow.canDoPushUps && openRow.ctaType === 'start_set' : canAddReps(b, now);
  return (
    <View style={styles.root}>
      {notifications}
      <ScrollView contentContainerStyle={styles.content}>
        {optInBanner}
        {justPlayed?.phoneMoved ? <Note title="Set ended" text="Your phone moved." /> : null}
        {cue.showClaimed && justPlayed ? (
          <Note
            title={`${justPlayed.counted} ${justPlayed.counted === 1 ? 'rep' : 'reps'} counted`}
            text={justPlayed.reps > justPlayed.counted ? `${justPlayed.reps - justPlayed.counted} too shallow.` : undefined}
          />
        ) : null}
        {cue.showPrompt ? (
          <Note title="Your turn" text="Only a set you start here counts. Your friend sees your score before they go." />
        ) : null}
        {queued.pending ? <Note title="Saving your set…" text="It uploads as soon as you're online." /> : null}
        {queued.failed && mine && mine.attemptsUsed === 0 ? (
          <Note title="Your set didn't count" text={friendlyError(queued.failed)} />
        ) : null}

        {duel ? (
          <Card padding={0} style={styles.top}>
            <View style={styles.duel}>
              <View style={styles.duelRow}>
                <Player name="You" avatar={personName(duel.you)} me score={headScore(b, duel.you)} />
                <Text variant="footnote" weight="500">
                  vs
                </Text>
                <Player name={personName(duel.them)} avatar={personName(duel.them)} score={headScore(b, duel.them)} />
              </View>
              {line ? (
                <Text variant="footnote" align="center" style={styles.duelLine}>
                  {line}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : team ? (
          <Card padding={0} style={styles.top}>
            <View style={styles.teamCard}>
              <Text variant="hero" size={52}>
                {formatCount(team.total)}
              </Text>
              {team.target > 0 ? <Text variant="footnote">{`of ${formatCount(team.target)} together`}</Text> : null}
              {team.target > 0 ? <ProgressBar progress={team.total / team.target} style={styles.teamBar} /> : null}
              {line ? (
                <Text variant="footnote" align="center" style={styles.duelLine}>
                  {line}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : (
          <>
            <ListGroup style={styles.top}>
              {standings(b).map((r) => (
                <StandingLine key={r.userId} row={r} size={18} />
              ))}
            </ListGroup>
            {line ? (
              <Text variant="footnote" style={styles.note}>
                {line}
              </Text>
            ) : null}
          </>
        )}

        {team ? (
          <>
            <SectionHeader title="Your part" />
            <ListGroup>
              {standings(b).map((r) => (
                <ListRow key={r.userId} title={r.name} value={r.note ?? r.score} />
              ))}
            </ListGroup>
          </>
        ) : null}

        <ListGroup style={styles.info}>
          <ListRow title="Kind" value={kindLabel(b)} />
          {b.kind === 'best_set' && b.durationS ? <ListRow title="Time limit" value={`${b.durationS} s`} /> : null}
          {b.kind === 'best_set' && (b.attemptsAllowed ?? 1) > 1 ? <ListRow title="Tries" value={String(b.attemptsAllowed)} /> : null}
          {lengthLabel(b) ? <ListRow title="Length" value={lengthLabel(b)!} /> : null}
          {b.endsAt ? <ListRow title="Ends" value={formatDeadline(b.endsAt, now, tz)} /> : null}
        </ListGroup>
        {errorLine}
      </ScrollView>
      {playable ? (
        <View style={styles.footer}>
          <Button title="Play" icon="play" onPress={() => onPlay(b)} />
        </View>
      ) : counting ? (
        <View style={styles.footer}>
          <Button title="Start a set" onPress={onStartSet} />
        </View>
      ) : null}
    </View>
  );
}

function Player({ name, avatar, me: mine, score }: { name: string; avatar: string; me?: boolean; score: string }) {
  const none = score === '–';
  return (
    <View style={styles.player} accessible accessibilityLabel={`${name}, ${none ? 'not played yet' : score}`}>
      <Avatar name={avatar} me={mine} size={56} />
      <Text variant="headline" style={styles.playerName} numberOfLines={1}>
        {name}
      </Text>
      <Text variant="hero" size={52} tone={none ? 'tertiary' : 'label'} style={styles.playerScore}>
        {score}
      </Text>
    </View>
  );
}

function StandingLine({ row, size }: { row: StandingRow; size: number }) {
  return (
    <View
      style={styles.standing}
      accessible
      accessibilityLabel={`${row.rank ? `${row.rank}. ` : ''}${row.name}, ${row.score}${row.note ? `, ${row.note}` : ''}`}
    >
      <Text variant="footnote" style={styles.rank} tabular>
        {row.rank ? String(row.rank) : '–'}
      </Text>
      <View style={styles.grow}>
        <Text variant="body" weight={row.me ? '600' : undefined} numberOfLines={1}>
          {row.name}
        </Text>
        {row.note ? <Text variant="footnote">{row.note}</Text> : null}
      </View>
      <Text variant="headline" weight="700" tabular style={{ fontSize: size, lineHeight: size + 4 }}>
        {row.score}
      </Text>
    </View>
  );
}

function Note({ title, text }: { title: string; text?: string }) {
  return (
    <Card style={styles.noteCard}>
      <Text variant="headline">{title}</Text>
      {text ? <Text variant="footnote">{text}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl },
  loading: { marginTop: 48 },
  error: { marginTop: space.sm },
  note: { marginTop: 10, marginHorizontal: space.xxs },
  noteCard: { marginTop: space.md },
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  footer: { paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
  footerRow: { flexDirection: 'row', gap: 10, paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
  // Invite
  inviteHead: { alignItems: 'center', marginTop: 40 },
  inviteTitle: { marginTop: space.md },
  inviteSub: { marginTop: 6 },
  inviteGroup: { marginTop: 28 },
  // Result
  resultHead: { alignItems: 'center', marginTop: 34 },
  crownSpace: { height: 22 },
  resultAvatar: { marginTop: space.xs },
  resultTitle: { marginTop: space.md },
  resultSub: { marginTop: space.xxs },
  resultGroup: { marginTop: 28 },
  // Your move
  top: { marginTop: space.md },
  duel: { paddingVertical: 22, paddingHorizontal: space.md },
  duelRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  duelLine: { marginTop: space.md },
  player: { alignItems: 'center', minWidth: 96 },
  playerName: { marginTop: space.xs },
  playerScore: { marginTop: space.xs, ...hero(52) },
  teamCard: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: space.md },
  teamBar: { alignSelf: 'stretch', marginTop: space.sm },
  info: { marginTop: space.sm },
  standing: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 52 },
  rank: { width: 14 },
});
