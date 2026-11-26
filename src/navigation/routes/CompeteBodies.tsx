import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LeagueView } from '../../screens/compete/LeagueView';
import { CompeteSignedOut } from '../../screens/compete/SignedOut';
import { ChallengesView } from '../../screens/compete/ChallengesView';
import { CompeteGate } from '../../screens/compete/Gate';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { fetchMyLeague, loadLeagueCache, saveLeagueCache, type LeagueBoard } from '../../backend/leagueClient';
import { supabase } from '../../backend/supabase';
import { REFRESH_FAILED } from '../../progress';
import { leagueView, type LeagueMode } from '../../progress/leagueView';
import { shareInvite } from '../../battles/inviteFriends';
import { EmptyState, color } from '../../ui';
import { useAppState } from '../appState';
import { openGoal } from './gate';
import type { TabProps } from '../types';

/** League segment of Compete (frames 16, 18, 19, E8, E9); signed out it is the sign-in pitch. */
export function LeagueBody({ navigation }: Pick<TabProps<'Compete'>, 'navigation'>) {
  const { configured, session } = useBackend();
  const { profile } = useIdentity();
  const userId = session?.user.id ?? null;
  const askedFor = useRef<string | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;
  const [board, setBoard] = useState<LeagueBoard | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [mode, setMode] = useState<LeagueMode>('total');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (userId && profile === null && askedFor.current !== userId && navigation.isFocused()) {
      askedFor.current = userId;
      navigation.navigate('ProfileSetup');
    }
  }, [userId, profile, navigation]);

  useEffect(() => {
    let alive = true;
    setBoard(null);
    setBanner(null);
    if (!userId) return undefined;
    loadLeagueCache(AsyncStorage, userId).then((cached) => {
      if (alive && cached) setBoard((current) => current ?? cached);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const reload = useCallback(() => {
    setNow(Date.now());
    if (!supabase || !userId || !profile) return;
    const requested = userId;
    fetchMyLeague(supabase)
      .then((doc) => {
        if (userRef.current !== requested) return;
        setBoard(doc);
        setBanner(null);
        setNow(Date.now());
        saveLeagueCache(AsyncStorage, userId, doc).catch(() => {});
      })
      .catch(() => {
        if (userRef.current === requested) setBanner(REFRESH_FAILED);
      });
  }, [userId, profile]);

  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);

  const view = useMemo(() => (board ? leagueView({ board, meId: userId, mode, now }) : null), [board, userId, mode, now]);

  if (!configured || !session) return <CompeteSignedOut configured={configured} />;
  if (profile === null) {
    return (
      <EmptyState
        icon="person"
        title="Pick a username"
        message="Friends find you by your username."
        actionTitle="Pick a username"
        onAction={() => navigation.navigate('ProfileSetup')}
      />
    );
  }
  if (profile === undefined) return <ActivityIndicator style={styles.loading} color={color.secondary} />;
  return (
    <LeagueView
      view={view}
      mode={mode}
      onMode={setMode}
      banner={banner}
      onStart={() => navigation.navigate('Session')}
      onInvite={() => shareInvite(profile.username)}
      onOpenPerson={(person) => {
        if (person.me) return;
        const row = board?.total.find((r) => r.userId === person.userId);
        if (!row) return;
        navigation.navigate('Friend', {
          friend: { userId: row.userId, username: row.username, displayName: row.displayName, relation: 'friend' },
        });
      }}
    />
  );
}

/** Challenges segment of Compete (frame 20, E10, E11). */
export function ChallengesBody({ navigation }: Pick<TabProps<'Compete'>, 'navigation'>) {
  const { profile } = useIdentity();
  const { enrollments } = useAppState();
  return (
    <CompeteGate onProfile={() => navigation.navigate('ProfileSetup')}>
      <ChallengesView
        hasGoal={openGoal(enrollments)}
        onNeedGoal={() => navigation.navigate('GoalSetup')}
        onOpen={(battle) => navigation.navigate('Battle', { challengeId: battle.id, battle })}
        onNew={() => navigation.navigate('NewBattle')}
        onInvite={() => profile && shareInvite(profile.username)}
      />
    </CompeteGate>
  );
}

const styles = StyleSheet.create({ loading: { marginTop: 48 } });
