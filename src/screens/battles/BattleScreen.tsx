import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../backend/supabase';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';
import { api } from '../../battles/api';
import {
  Battle,
  battleSubtitle,
  battleTitle,
  canPlay,
  canRespond,
  friendlyError,
  inviteShareMessage,
  inviteUrl,
  isOpen,
  me,
  Participant,
  personName,
  scoreLabel,
  timeLeft,
} from '../../battles/model';
import { flushBattleUploads, onBattleUploads } from '../../battles/uploader';
import { loadBattleQueue } from '../../battles/uploadQueue';
import { AccountGate, Header, Notice, Row, s, SectionTitle, SmallButton } from './common';

export function BattleScreen(props: {
  battleId: string;
  share?: boolean;
  justPlayed?: { reps: number; counted: number };
  onBack: () => void;
  onPlay: (b: Battle) => void;
  onAccount: () => void;
  onProfile: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={s.container}>
      <Header title="Battle" onBack={props.onBack} />
      <AccountGate onAccount={props.onAccount} onProfile={props.onProfile}>
        <BattleDetail {...props} />
      </AccountGate>
    </ScrollView>
  );
}

function BattleDetail({
  battleId,
  share,
  justPlayed,
  onPlay,
  onBack,
}: {
  battleId: string;
  share?: boolean;
  justPlayed?: { reps: number; counted: number };
  onPlay: (b: Battle) => void;
  onBack: () => void;
}) {
  const { appSettings } = useBackend();
  const { profile } = useIdentity();
  const [b, setB] = useState<Battle | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<{ pending: boolean; failed: string | null }>({ pending: false, failed: null });
  const shared = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const q = await loadBattleQueue(AsyncStorage);
    setQueued({
      pending: q.pending.some((x) => x.battleId === battleId),
      failed: q.failed.filter((x) => x.battleId === battleId).pop()?.error ?? null,
    });
    const r = await api.battle(supabase, battleId);
    if (r.ok) {
      setB(r.data);
      setError(null);
    } else setError(friendlyError(r.message));
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
      if ((n.request.content.data as { battleId?: string })?.battleId === battleId) load();
    });
    return () => sub.remove();
  }, [battleId, load]);
  // Standings move while others play; refresh every 20 s while open.
  useEffect(() => {
    if (!b || !isOpen(b)) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [b, load]);

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(friendlyError(r.message));
    else if (supabase) api.kickNotify(supabase);
    await load();
    return r.ok;
  };

  const shareLink = async (battle: Battle) => {
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
  };

  useEffect(() => {
    if (share && b && !shared.current && b.createdBy === profile?.id && isOpen(b)) {
      shared.current = true;
      shareLink(b);
    }
  }, [share, b]); // eslint-disable-line react-hooks/exhaustive-deps

  if (b === undefined) return error ? <Text style={s.error}>{error}</Text> : <Text style={s.muted}>Loading…</Text>;
  if (b === null) return <Notice title="Battle not found" text="It may have been removed, or you're not part of it." />;

  const mine = me(b);
  const creator = b.participants.find((p) => p.userId === b.createdBy);
  const isCreator = b.createdBy === profile?.id;
  const rules =
    b.format === 'timed'
      ? `${b.durationS ?? 60} seconds, as many good reps as you can.`
      : `As many good reps as you can in one set. It ends after ${appSettings.asyncBattleDefaults.maxRepsIdleEndS} s without a rep.`;

  return (
    <View>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '900' }}>{battleTitle(b)}</Text>
      <Text style={[s.muted, { marginBottom: 8 }]}>
        {creator ? `Started by ${creator.isMe ? 'you' : personName(creator)} · ` : ''}
        {battleSubtitle(b)}
      </Text>
      <View style={s.card}>
        <Text style={s.text}>{rules}</Text>
        <Text style={[s.muted, { marginTop: 6 }]}>
          Only Good and Full reps count. Shallow reps don't. {b.attemptsAllowed === 1 ? 'One attempt each.' : `${b.attemptsAllowed} attempts each.`}
          {b.endsAt && isOpen(b) ? ` Deadline: ${new Date(b.endsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (${timeLeft(b.endsAt)}).` : ''}
        </Text>
      </View>

      {justPlayed ? (
        <Notice
          title={`${justPlayed.counted} good ${justPlayed.counted === 1 ? 'rep' : 'reps'}`}
          text={
            justPlayed.reps > justPlayed.counted
              ? `${justPlayed.reps - justPlayed.counted} shallow ${justPlayed.reps - justPlayed.counted === 1 ? 'rep' : 'reps'} didn't count.`
              : 'Every rep counted.'
          }
        />
      ) : null}
      {queued.pending ? (
        <Notice title="Uploading your attempt…" text="It's saved on this phone and uploads as soon as you're online." />
      ) : null}
      {queued.failed && mine && mine.attemptsUsed === 0 ? (
        <Notice title="Your attempt wasn't accepted" text={friendlyError(queued.failed)} />
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {canRespond(b) ? (
        <View style={s.card}>
          <Text style={s.bold}>You're invited</Text>
          <Text style={s.muted}>Answer within {timeLeft(b.inviteExpiresAt)}.</Text>
          <Button title="Accept" onPress={() => !busy && run(() => api.respond(supabase!, b.id, profile!.id, true))} />
          <Button title="Decline" kind="secondary" onPress={() => !busy && run(() => api.respond(supabase!, b.id, profile!.id, false))} />
        </View>
      ) : null}

      {canPlay(b) && !queued.pending ? (
        <Button
          title="Start your attempt"
          onPress={() =>
            Alert.alert('Ready?', `${rules}\n\nThe attempt counts once counting starts after calibration.`, [
              { text: 'Not yet', style: 'cancel' },
              { text: 'Go', onPress: () => onPlay(b) },
            ])
          }
        />
      ) : null}

      <SectionTitle>{b.status === 'completed' ? 'Final results 🔒' : 'Standings'}</SectionTitle>
      {b.participants.map((p) => (
        <Standing key={p.userId} p={p} b={b} />
      ))}

      {isCreator && isOpen(b) ? (
        <>
          <SectionTitle>Invite</SectionTitle>
          <Text style={[s.muted, { marginBottom: 4 }]}>
            Anyone with the link can join (up to {b.maxParticipants} players) and becomes your friend.
          </Text>
          <Button title={b.inviteLinks.length ? 'Share invite link' : 'Create & share invite link'} kind="secondary" onPress={() => shareLink(b)} />
          {b.inviteLinks.map((l) => (
            <Row key={l.token}>
              <Text style={[s.muted, { flex: 1 }]}>
                Link · used {l.uses}/{l.maxUses} · {timeLeft(l.expiresAt)}
              </Text>
              <SmallButton title="Turn off" kind="secondary" onPress={() => run(() => api.revokeInviteLink(supabase!, l.token))} />
            </Row>
          ))}
          <Button
            title="Cancel battle"
            kind="danger"
            onPress={() =>
              Alert.alert('Cancel this battle?', 'Everyone in it is told it was cancelled.', [
                { text: 'Keep it', style: 'cancel' },
                {
                  text: 'Cancel battle',
                  style: 'destructive',
                  onPress: async () => (await run(() => api.cancelBattle(supabase!, b.id))) && onBack(),
                },
              ])
            }
          />
        </>
      ) : null}
    </View>
  );
}

function Standing({ p, b }: { p: Participant; b: Battle }) {
  const played = p.attemptsUsed > 0;
  const status =
    p.status === 'invited'
      ? 'invited'
      : p.status === 'declined'
        ? 'declined'
        : p.status === 'expired' || p.status === 'forfeited'
          ? "didn't play"
          : played
            ? p.avgDepthPct != null
              ? `avg depth ${Math.round(p.avgDepthPct)}%`
              : 'done'
            : 'not played yet';
  return (
    <Row style={p.isMe ? { borderWidth: 1, borderColor: colors.accent } : undefined}>
      <Text style={{ color: colors.muted, width: 28, fontWeight: '800', fontSize: 16 }}>{played && p.rank ? p.rank : '–'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.bold}>
          {p.isMe ? 'You' : personName(p)}
          {p.isWinner && b.status === 'completed' ? ' 🏆' : ''}
        </Text>
        <Text style={s.muted}>{status}</Text>
      </View>
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{scoreLabel(p, b.metric)}</Text>
    </Row>
  );
}
