import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LeagueScreen } from '../../screens/LeagueScreen';
import { BattlesScreen } from '../../screens/battles/BattlesScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { fetchMyLeague, loadLeagueCache, saveLeagueCache, type LeagueBoard } from '../../backend/leagueClient';
import { supabase } from '../../backend/supabase';
import { REFRESH_FAILED } from '../../progress';
import { gate } from './gate';
import type { TabProps } from '../types';

/** The old League tab, now the League segment of Compete. */
export function LeagueBody({ navigation }: Pick<TabProps<'Compete'>, 'navigation'>) {
  const { configured, session } = useBackend();
  const { profile } = useIdentity();
  const userId = session?.user.id ?? null;
  const askedFor = useRef<string | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;
  const [board, setBoard] = useState<LeagueBoard | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

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
    if (!supabase || !userId || !profile) return;
    const requested = userId;
    fetchMyLeague(supabase)
      .then((doc) => {
        if (userRef.current !== requested) return;
        setBoard(doc);
        setBanner(null);
        saveLeagueCache(AsyncStorage, userId, doc).catch(() => {});
      })
      .catch(() => {
        if (userRef.current === requested) setBanner(REFRESH_FAILED);
      });
  }, [userId, profile]);

  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);

  return (
    <LeagueScreen
      configured={configured}
      signedIn={!!session}
      username={profile === undefined ? 'loading' : profile === null ? 'needed' : 'ready'}
      board={board}
      banner={banner}
      meId={userId}
      onAddFriend={() => navigation.navigate('Friends')}
      onOpenFriend={(row) => {
        if (!userId || row.userId === userId) return;
        navigation.navigate('Friend', {
          friend: { userId: row.userId, username: row.username, displayName: row.displayName, relation: 'friend' },
        });
      }}
      onProfile={() => navigation.navigate('ProfileSetup')}
    />
  );
}

/** The old Challenges tab, now the Challenges segment of Compete. */
export function ChallengesBody({ navigation }: Pick<TabProps<'Compete'>, 'navigation'>) {
  return (
    <BattlesScreen
      {...gate(navigation)}
      onOpen={(battle) => navigation.navigate('Battle', { challengeId: battle.id, battle })}
      onNew={() => navigation.navigate('NewBattle')}
      onFriends={() => navigation.navigate('Friends')}
    />
  );
}
