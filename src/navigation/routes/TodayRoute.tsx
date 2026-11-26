import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

import { TodayScreen } from '../../screens/TodayScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { historyStore } from '../../session/useSession';
import { faceTrackingSupported } from '../../sensors';
import { deviceTimeZone } from '../../backend/profile';
import { fetchRecapRanks } from '../../backend/nudgeClient';
import { supabase } from '../../backend/supabase';
import { REFRESH_FAILED, WeekRanks, buildToday, localDate, signedInViews, weekCard, workoutFromRecord } from '../../progress';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { TabProps } from '../types';

export function TodayRoute({ navigation }: TabProps<'Today'>) {
  const { savedSets, refreshSavedSets, enrollments, remote, refreshRemote, howToOpen, openHowTo, closeHowTo } = useAppState();
  const { session } = useBackend();
  const { profile } = useIdentity();
  const focused = useIsFocused();
  const askedFor = useRef<string | null>(null);
  const [workouts, setWorkouts] = useState<ReturnType<typeof workoutFromRecord>[]>([]);
  const [ranks, setRanks] = useState<WeekRanks | null>(null);
  const reload = useCallback(() => {
    refreshSavedSets();
    refreshRemote();
    historyStore.load().then((rows) => setWorkouts(rows.map(workoutFromRecord))).catch(() => {});
  }, [refreshSavedSets, refreshRemote]);
  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);
  useEffect(() => {
    const uid = session?.user.id;
    if (uid && profile === null && askedFor.current !== uid && navigation.isFocused()) {
      askedFor.current = uid;
      navigation.navigate('ProfileSetup');
    }
  }, [session, profile, navigation]);
  const zone = deviceTimeZone();
  const now = Date.now();
  const today = localDate(now, zone);
  const phone = buildToday({ workouts, enrollments, today, timeZone: zone });
  const view = session && remote.doc && remote.status === 'ready' ? signedInViews(remote.doc, workouts).today : phone;
  const banner = session && remote.status === 'error' ? REFRESH_FAILED : null;
  const weekStart = weekCard({ now, timeZone: zone, workouts, enrollments, signedIn: !!session, ranks: null })?.weekStart ?? null;
  useEffect(() => {
    if (!weekStart || !session || !profile || !supabase) {
      setRanks(null);
      return undefined;
    }
    let alive = true;
    fetchRecapRanks(supabase, weekStart)
      .then((next) => {
        if (alive) setRanks(next);
      })
      .catch(() => {
        if (alive) setRanks(null);
      });
    return () => {
      alive = false;
    };
  }, [weekStart, session, profile]);
  const week = weekCard({ now, timeZone: zone, workouts, enrollments, signedIn: !!session, ranks });
  return (
    <Frame kind="tab">
    <TodayScreen
      view={view}
      banner={banner}
      week={week}
      depth={faceTrackingSupported()}
      howToOpen={howToOpen && focused}
      savedSets={savedSets}
      onStart={() => navigation.navigate('Session')}
      onGoal={() => navigation.navigate('GoalSetup')}
      onAccount={() => navigation.navigate('Settings')}
      onWeek={week ? () => (week.destination === 'league' ? navigation.navigate('Compete', { segment: 'league' }) : navigation.navigate('You')) : undefined}
      onOpenHowTo={openHowTo}
      onCloseHowTo={closeHowTo}
    />
    </Frame>
  );
}
