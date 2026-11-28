import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

import { NotificationOptInBanner } from '../../components/NotificationPrompt';
import { TodayScreen } from '../../screens/TodayScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { fetchMyLeague, loadLeagueCache, saveLeagueCache, type LeagueBoard } from '../../backend/leagueClient';
import { historyStore } from '../../session/useSession';
import { faceTrackingSupported } from '../../sensors';
import { deviceTimeZone } from '../../backend/profile';
import { supabase } from '../../backend/supabase';
import { api } from '../../battles/api';
import type { OpenChallenge } from '../../battles/openChallenges';
import { rememberBattles } from '../../battles/battleCache';
import type { Battle } from '../../battles/model';
import {
  REFRESH_FAILED,
  buildProgress,
  buildToday,
  enrollmentsFromServer,
  formatTodaySubtitle,
  goalForDate,
  localDate,
  mergeWorkouts,
  signedInViews,
  streaks,
  workoutFromRecord,
} from '../../progress';
import { buildTodayView } from '../../ui/models/today';
import { useAppState } from '../appState';
import { useOnboardingGate } from './OnboardingRoutes';
import { Frame } from '../frame';
import type { TabProps } from '../types';

export function TodayRoute({ navigation }: TabProps<'Today'>) {
  const { enrollments, remote, refreshRemote } = useAppState();
  const gateReady = useOnboardingGate(navigation);
  const { session } = useBackend();
  const { profile } = useIdentity();
  const userId = session?.user.id ?? null;
  const askedFor = useRef<string | null>(null);
  const [workouts, setWorkouts] = useState<ReturnType<typeof workoutFromRecord>[]>([]);
  // Keyed by account: a reply that lands after a sign-out or account switch is never shown.
  const [boardFor, setBoardFor] = useState<{ userId: string; board: LeagueBoard } | null>(null);
  const [battlesFor, setBattlesFor] = useState<{ userId: string; battles: Battle[] } | null>(null);
  const [openFor, setOpenFor] = useState<{ userId: string; rows: OpenChallenge[] } | null>(null);
  const board = userId && boardFor?.userId === userId ? boardFor.board : null;
  const battles = userId && battlesFor?.userId === userId ? battlesFor.battles : null;
  const openRows = userId && openFor?.userId === userId ? openFor.rows : null;
  const [now, setNow] = useState(() => Date.now());

  // Last board for this account first, so the card paints before the refresh.
  useEffect(() => {
    if (!userId) return;
    loadLeagueCache(AsyncStorage, userId).then((cached) => {
      if (cached) setBoardFor((current) => (current?.userId === userId ? current : { userId, board: cached }));
    });
  }, [userId]);

  // League and challenges need a signed-in account with a username.
  const reloadCompete = useCallback(() => {
    if (!supabase || !userId || !profile) return;
    fetchMyLeague(supabase)
      .then((doc) => {
        setBoardFor({ userId, board: doc });
        saveLeagueCache(AsyncStorage, userId, doc).catch(() => {});
      })
      .catch(() => {});
    api.myBattles(supabase).then((r) => {
      if (!r.ok) return;
      const rows = r.data ?? [];
      rememberBattles(rows);
      setBattlesFor({ userId, battles: rows });
    });
    api.myOpenChallenges(supabase).then((r) => {
      if (!r.ok) return;
      setOpenFor({ userId, rows: r.data ?? [] });
    });
  }, [userId, profile]);
  // One my_progress, one my_league and one my_challenges call per focus. The league and
  // challenges also load when sign-in or the username finishes while Today is open.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      refreshRemote();
      historyStore.load().then((rows) => setWorkouts(rows.map(workoutFromRecord))).catch(() => {});
    }, [refreshRemote]),
  );
  useFocusEffect(reloadCompete);
  const focused = useIsFocused();
  // Back from the background: today's date and the time left on challenges move on.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (userId && profile === null && askedFor.current !== userId && navigation.isFocused()) {
      askedFor.current = userId;
      navigation.navigate('ProfileSetup');
    }
  }, [userId, profile, navigation]);

  const zone = deviceTimeZone();
  const today = localDate(now, zone);
  const doc = session && remote.doc && remote.status === 'ready' ? remote.doc : null;
  const phone = buildToday({ workouts, enrollments, today, timeZone: zone });
  const signed = doc ? signedInViews(doc, workouts) : null;
  const day = signed ? signed.today : phone;
  const progress = signed ? signed.progress : buildProgress({ workouts, enrollments, today, timeZone: zone, storedCount: workouts.length });
  const currentStreak = doc
    ? signed?.unsynced
      ? streaks(mergeWorkouts(doc.sets, workouts).workouts, enrollmentsFromServer(doc.enrollments), doc.today, doc.timeZone).current
      : doc.currentStreak
    : streaks(workouts, enrollments, today, zone).current;
  const view = buildTodayView({
    today,
    reps: day.reps,
    target: day.target,
    rest: day.rest,
    currentStreak,
    dayOne: progress.empty && day.reps === 0,
    days: progress.day,
    targetFor: (date) => goalForDate(enrollments, date)?.target ?? null,
    signedIn: !!session,
    meId: userId,
    board,
    battles,
    now,
  });
  const banner = session && remote.status === 'error' ? REFRESH_FAILED : null;

  // Blank (black) for the moment the first-run check takes, so Today doesn't flash before Welcome.
  if (!gateReady) return <Frame kind="tab">{null}</Frame>;
  return (
    <Frame kind="tab">
      <TodayScreen
        view={view}
        active={focused}
        date={formatTodaySubtitle(now, zone)}
        banner={banner}
        note={day.travelLine}
        depth={faceTrackingSupported()}
        onStart={() => navigation.navigate('Session')}
        onGoal={() => navigation.navigate('GoalSetup')}
        onLeague={() => navigation.navigate('Compete', { segment: 'league' })}
        onChallenge={(challengeId) => navigation.navigate('Battle', { challengeId, battle: battles?.find((b) => b.id === challengeId) })}
        onNewChallenge={() => navigation.navigate('NewBattle')}
        onInvite={() => (session ? navigation.navigate('Friends') : navigation.navigate('Compete', { segment: 'league' }))}
        onHowItWorks={() => navigation.navigate('HowItWorks')}
        onSeeAll={() => navigation.navigate('Compete', { segment: 'challenges' })}
        openRows={progress.empty && day.reps === 0 ? null : openRows}
        optInBanner={<NotificationOptInBanner />}
      />
    </Frame>
  );
}
