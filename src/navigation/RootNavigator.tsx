import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as AppLifecycle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import { DEFAULT_SETTINGS, Settings, loadSettings, saveSettings } from '../storage/settings';
import { historyStore } from '../session/useSession';
import { colors } from '../theme';
import { APP_SCHEME, notificationLink, parseAppLink } from '../backend/linking';
import { personName } from '../battles/model';
import { deviceTimeZone } from '../backend/profile';
import { enrollGoal, fetchMyProgress } from '../backend/progressClient';
import { fetchNotificationPrefs, saveNotificationPrefs } from '../backend/nudgeClient';
import { onHistoryChanged, onServerSetsChanged } from '../backend/syncEvents';
import { supabase } from '../backend/supabase';
import {
  DAILY_NUDGE_ID,
  DEFAULT_NUDGE_PREFS,
  GoalEnrollment,
  GoalSnapshot,
  GOAL_SYNC_KEY,
  NUDGE_FIRED_KEY,
  NUDGE_SYNC_KEY,
  NudgePrefs,
  NudgeSyncState,
  ServerProgress,
  decideGoalSync,
  decideNudgeSync,
  enrollmentsFromServer,
  goalSnapshot,
  goalSyncSettled,
  lateSetIds,
  goalForDate,
  loadGoal,
  loadNudges,
  localDate,
  nextLocalReminder,
  queueGoalEdit,
  sanitizeGoalSync,
  sanitizeNudgeSync,
  saveEnrollment,
  saveGoal,
  saveNudges,
  workoutDate,
  workoutFromRecord,
} from '../progress';
import { header } from './headerOptions';
import { AppStateContext, type RemoteProgress } from './appState';
import { getStateFromPath, linkingConfig } from './linkingConfig';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';
import { SessionRoute } from './routes/SessionRoute';
import { SummaryRoute } from './routes/SummaryRoute';
import { AllSetsRoute } from './routes/AllSetsRoute';
import { DailyReminderRoute, QuietHoursRoute, SettingsRoute } from './routes/SettingsRoute';
import { GoalRoute, ProfileSetupRoute } from './routes/GoalRoutes';
import { GoalPickRoute, HowItWorksRoute, WelcomeRoute } from './routes/OnboardingRoutes';
import { BattleRoute, FriendRoute, FriendsRoute, InviteRoute, LeagueInfoRoute, NewBattleRoute } from './routes/ChallengeRoutes';

export type { RootStackParamList, TabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Web invite links (https://<domain>/b/<token>, once a domain exists) are mapped to the scheme form. */
let webBaseUrl: string | null = null;

/** Frame 5: the goal sheet, a native form sheet (grabber, 34 pt corners). */
const GOAL_SHEET: NativeStackNavigationOptions = {
  presentation: 'formSheet',
  sheetAllowedDetents: [0.62, 1],
  sheetGrabberVisible: true,
  sheetCornerRadius: 34,
  contentStyle: { backgroundColor: colors.card },
};

/** Frame 21: New challenge, a full-height native form sheet with its own Cancel / title row. */
const NEW_CHALLENGE_SHEET: NativeStackNavigationOptions = {
  presentation: 'formSheet',
  sheetAllowedDetents: [1],
  sheetGrabberVisible: true,
  sheetCornerRadius: 34,
  contentStyle: { backgroundColor: colors.card },
};

/** The league's (i): how the two boards work, a short native sheet. */
const LEAGUE_INFO_SHEET: NativeStackNavigationOptions = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  sheetCornerRadius: 34,
  contentStyle: { backgroundColor: colors.card },
};

const normalizeUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const link = parseAppLink(url, webBaseUrl);
  if (link?.type === 'invite' && !url.toLowerCase().startsWith(`${APP_SCHEME}://`)) return `${APP_SCHEME}://invite/${link.token}`;
  return url;
};
const pushUrl = (r: Notifications.NotificationResponse | null | undefined) =>
  r ? notificationLink(r.notification.request.content.data, webBaseUrl) : null;

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), `${APP_SCHEME}://`],
  config: linkingConfig,
  getStateFromPath,
  // Cold start from a link or from tapping one of our pushes (data.url).
  async getInitialURL() {
    const url = normalizeUrl(await Linking.getInitialURL());
    if (url) return url;
    return pushUrl(Notifications.getLastNotificationResponse());
  },
  subscribe(listener) {
    const links = Linking.addEventListener('url', ({ url }) => {
      const u = normalizeUrl(url);
      if (u) listener(u);
    });
    const taps = Notifications.addNotificationResponseReceivedListener((r) => {
      const u = pushUrl(r);
      if (u) listener(u);
    });
    return () => {
      links.remove();
      taps.remove();
    };
  },
};

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.accent },
};

function openServerEnrollment(doc: ServerProgress | null): GoalSnapshot | null {
  const open = [...(doc?.enrollments ?? [])].reverse().find((row) => row.endedOn === null) ?? null;
  return goalSnapshot(open);
}

export function RootNavigator() {
  const { appSettings, session } = useBackend();
  const { profile, push } = useIdentity();
  webBaseUrl = appSettings.inviteLinks.webBaseUrl;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [nudges, setNudges] = useState<NudgePrefs>(DEFAULT_NUDGE_PREFS);
  const [nudgesReady, setNudgesReady] = useState(false);
  const [reminderTick, setReminderTick] = useState(0);
  const [savedSets, setSavedSets] = useState(0);
  const [enrollments, setEnrollments] = useState<GoalEnrollment[]>([]);
  const [remote, setRemote] = useState<RemoteProgress>({ doc: null, status: 'idle' });
  const [lateIds, setLateIds] = useState<ReadonlySet<string>>(() => new Set());
  const goalSyncRef = useRef<ReturnType<typeof sanitizeGoalSync> | null>(null);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const refreshGen = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const enrollmentsRef = useRef(enrollments);
  enrollmentsRef.current = enrollments;
  const goalEpoch = useRef(0);
  const nudgeSyncRef = useRef<NudgeSyncState | null>(null);
  const nudgeGen = useRef(0);
  const nudgesRef = useRef(nudges);
  nudgesRef.current = nudges;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const askedReminder = useRef(false);
  const firedRef = useRef<string | null>(null);
  const reminderFlight = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    loadSettings(AsyncStorage).then(setSettings);
    loadGoal(AsyncStorage)
      .then((rows) => {
        if (goalEpoch.current === 0) setEnrollments(rows);
      })
      .catch(() => {});
    AsyncStorage.getItem(GOAL_SYNC_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as { userId?: unknown };
        if (typeof parsed.userId === 'string') goalSyncRef.current = sanitizeGoalSync(parsed, parsed.userId);
      })
      .catch(() => {});
    loadNudges(AsyncStorage)
      .then((prefs) => {
        setNudges(prefs);
        setNudgesReady(true);
      })
      .catch(() => setNudgesReady(true));
    AsyncStorage.getItem(NUDGE_SYNC_KEY)
      .then((raw) => {
        if (!raw) return;
        nudgeSyncRef.current = sanitizeNudgeSync(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  const refreshSavedSets = useCallback(() => {
    historyStore.load().then((h) => setSavedSets(h.length)).catch(() => {});
  }, []);

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(AsyncStorage, s).catch(() => {});
  }, []);

  const updateNudges = useCallback((prefs: NudgePrefs) => {
    nudgeGen.current += 1;
    setNudges(prefs);
    saveNudges(AsyncStorage, prefs).catch(() => {});
    const userId = sessionRef.current?.user.id;
    if (!userId || !profileRef.current || !supabase) return;
    const settled = { userId, settled: true };
    nudgeSyncRef.current = settled;
    AsyncStorage.setItem(NUDGE_SYNC_KEY, JSON.stringify(settled)).catch(() => {});
    saveNotificationPrefs(supabase, userId, prefs).catch(() => {});
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!nudgesReady || !userId || !profile || !supabase) return undefined;
    const gen = nudgeGen.current;
    const client = supabase;
    let alive = true;
    fetchNotificationPrefs(client)
      .then(async (server) => {
        if (!alive || gen !== nudgeGen.current) return;
        const decision = decideNudgeSync({
          userId,
          local: nudgesRef.current,
          server,
          sync: nudgeSyncRef.current,
        });
        nudgeSyncRef.current = decision.next;
        await AsyncStorage.setItem(NUDGE_SYNC_KEY, JSON.stringify(decision.next));
        if (!alive || gen !== nudgeGen.current) return;
        if (decision.action.type === 'adopt') {
          setNudges(decision.action.prefs);
          await saveNudges(AsyncStorage, decision.action.prefs);
        } else if (decision.action.type === 'upload') {
          await saveNotificationPrefs(client, userId, decision.action.prefs);
          if (!alive || gen !== nudgeGen.current) return;
          const settled = { userId, settled: true };
          nudgeSyncRef.current = settled;
          await AsyncStorage.setItem(NUDGE_SYNC_KEY, JSON.stringify(settled));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [nudgesReady, session?.user.id, profile]);

  useEffect(() => {
    const off = onHistoryChanged(() => setReminderTick((n) => n + 1));
    const sub = AppLifecycle.addEventListener('change', (state) => {
      if (state === 'active') setReminderTick((n) => n + 1);
    });
    return () => {
      off();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!nudgesReady) return undefined;
    let alive = true;
    const run = async () => {
      const zone = deviceTimeZone();
      const now = Date.now();
      const today = localDate(now, zone);
      const rows = await historyStore.load().catch(() => []);
      if (!alive) return;
      const repsToday = rows
        .map(workoutFromRecord)
        .filter((workout) => workoutDate(workout, zone) === today)
        .reduce((sum, workout) => sum + workout.countedReps, 0);
      if (firedRef.current == null) firedRef.current = await AsyncStorage.getItem(NUDGE_FIRED_KEY);
      const when = nextLocalReminder({
        prefs: nudgesRef.current,
        timeZone: zone,
        signedIn: !!sessionRef.current,
        pushRegistered: push.registered,
        enrollments: enrollmentsRef.current,
        repsToday,
        lastFiredDate: firedRef.current,
        now,
      });
      await Notifications.cancelScheduledNotificationAsync(DAILY_NUDGE_ID).catch(() => {});
      if (!alive || !when) return;
      const permission = await Notifications.getPermissionsAsync().catch(() => null);
      let granted = permission?.granted === true;
      if (!granted && permission?.canAskAgain && nudgesRef.current.dailyNudge && !askedReminder.current) {
        askedReminder.current = true;
        const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }).catch(() => null);
        granted = asked?.granted === true;
      }
      if (!alive || !granted) return;
      const day = localDate(when.getTime(), zone);
      const goal = goalForDate(enrollmentsRef.current, day);
      const target = goal && goal.target > 0 ? goal.target : null;
      if (!target) return;
      const immediate = when.getTime() <= Date.now();
      if (immediate) {
        firedRef.current = today;
        await AsyncStorage.setItem(NUDGE_FIRED_KEY, today);
      }
      await Notifications.scheduleNotificationAsync({
        identifier: DAILY_NUDGE_ID,
        content: {
          title: 'Today',
          body: `No push-ups yet today. Your goal is ${target}.`,
          data: { type: 'daily_nudge', url: 'pushupcounter://today' },
        },
        trigger: immediate ? null : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      }).catch(() => {});
    };
    const flight = reminderFlight.current.then(run, run);
    reminderFlight.current = flight;
    return () => {
      alive = false;
    };
  }, [nudgesReady, nudges, enrollments, push.registered, session?.user.id, reminderTick]);

  const refreshRemote = useCallback(() => {
    const gen = ++refreshGen.current;
    const userId = sessionRef.current?.user.id ?? null;
    if (!supabase || !userId) {
      setRemote({ doc: null, status: 'idle' });
      setLateIds(new Set());
      return;
    }
    const client = supabase;
    fetchMyProgress(client)
      .then(async (doc) => {
        if (gen !== refreshGen.current) return;
        const storedGoal = await loadGoal(AsyncStorage);
        if (!goalSyncRef.current) {
          const raw = await AsyncStorage.getItem(GOAL_SYNC_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { userId?: unknown };
            if (typeof parsed.userId === 'string') goalSyncRef.current = sanitizeGoalSync(parsed, parsed.userId);
          }
        }
        if (gen !== refreshGen.current) return;
        const local = enrollmentsRef.current.length ? enrollmentsRef.current : storedGoal;
        const decision = decideGoalSync({
          userId,
          local,
          server: doc.enrollments,
          sync: goalSyncRef.current,
        });
        goalSyncRef.current = decision.next;
        await AsyncStorage.setItem(GOAL_SYNC_KEY, JSON.stringify(decision.next));
        if (gen !== refreshGen.current) return;
        let shown = doc;
        if (decision.action.type === 'adopt') {
          const next = enrollmentsFromServer(doc.enrollments);
          goalEpoch.current += 1;
          setEnrollments(next);
          await saveGoal(AsyncStorage, next);
        } else if (decision.action.type === 'clear') {
          goalEpoch.current += 1;
          setEnrollments([]);
          await saveGoal(AsyncStorage, []);
        } else if (decision.action.type === 'upload') {
          await enrollGoal(client, decision.action.choice);
          shown = await fetchMyProgress(client);
          if (gen !== refreshGen.current) return;
          const settled = goalSyncSettled(userId, openServerEnrollment(shown));
          goalSyncRef.current = settled;
          await AsyncStorage.setItem(GOAL_SYNC_KEY, JSON.stringify(settled));
          const next = enrollmentsFromServer(shown.enrollments);
          goalEpoch.current += 1;
          setEnrollments(next);
          await saveGoal(AsyncStorage, next);
        }
        if (gen !== refreshGen.current) return;
        setRemote({ doc: shown, status: 'ready' });
        setLateIds(new Set(lateSetIds(shown.sets)));
      })
      .catch(() => {
        if (gen !== refreshGen.current) return;
        setRemote((current) => ({ doc: current.doc, status: 'error' }));
      });
  }, []);

  // A delete reached the backup: Today and You show server totals, so reload them.
  useEffect(() => onServerSetsChanged(refreshRemote), [refreshRemote]);

  useEffect(() => {
    if (session?.user.id) refreshRemote();
    else {
      refreshGen.current += 1;
      setRemote({ doc: null, status: 'idle' });
      setLateIds(new Set());
    }
  }, [session?.user.id, refreshRemote]);

  const saveChoice = useCallback((choice: Parameters<typeof saveEnrollment>[1]): Promise<void> => {
    const zone = deviceTimeZone();
    const today = localDate(Date.now(), zone);
    const result = saveEnrollment(enrollmentsRef.current, choice, today, zone, `goal-${today}-${Date.now()}`);
    if (!result.ok) return Promise.resolve();
    goalEpoch.current += 1;
    setEnrollments(result.enrollments);
    saveGoal(AsyncStorage, result.enrollments).catch(() => {});
    const userId = sessionRef.current?.user.id;
    if (!userId || !supabase) {
      const prev = goalSyncRef.current;
      if (prev?.settled) {
        const next = { ...prev, settled: false, pending: null };
        goalSyncRef.current = next;
        AsyncStorage.setItem(GOAL_SYNC_KEY, JSON.stringify(next)).catch(() => {});
      }
      return Promise.resolve();
    }
    const queued = queueGoalEdit(userId, choice, openServerEnrollment(remoteRef.current.doc));
    goalSyncRef.current = queued;
    AsyncStorage.setItem(GOAL_SYNC_KEY, JSON.stringify(queued)).catch(() => {});
    const client = supabase;
    return enrollGoal(client, choice)
      .then(async () => {
        const doc = await fetchMyProgress(client);
        const settled = goalSyncSettled(userId, openServerEnrollment(doc));
        goalSyncRef.current = settled;
        await AsyncStorage.setItem(GOAL_SYNC_KEY, JSON.stringify(settled));
        const next = enrollmentsFromServer(doc.enrollments);
        goalEpoch.current += 1;
        setEnrollments(next);
        await saveGoal(AsyncStorage, next);
        setRemote({ doc, status: 'ready' });
        setLateIds(new Set(lateSetIds(doc.sets)));
      })
      .catch(() => {
        setRemote((current) => ({ doc: current.doc, status: 'error' }));
      });
  }, []);

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      nudges,
      updateNudges,
      savedSets,
      refreshSavedSets,
      enrollments,
      saveChoice,
      remote,
      lateIds,
      refreshRemote,
    }),
    [settings, updateSettings, nudges, updateNudges, savedSets, refreshSavedSets, enrollments, saveChoice, remote, lateIds, refreshRemote],
  );

  return (
    <AppStateContext.Provider value={value}>
      <NavigationContainer linking={linking} theme={theme}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Welcome" component={WelcomeRoute} options={{ gestureEnabled: false, animation: 'none' }} />
          <Stack.Screen name="GoalPick" component={GoalPickRoute} />
          <Stack.Screen name="HowItWorks" component={HowItWorksRoute} />
          <Stack.Screen name="GoalSetup" component={GoalRoute} options={GOAL_SHEET} />
          <Stack.Screen name="Session" component={SessionRoute} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Summary" component={SummaryRoute} />
          <Stack.Screen name="AllSets" component={AllSetsRoute} options={header('All sets')} />
          <Stack.Screen name="Settings" component={SettingsRoute} options={header('Settings')} />
          <Stack.Screen name="DailyReminder" component={DailyReminderRoute} options={header('Daily reminder')} />
          <Stack.Screen name="QuietHours" component={QuietHoursRoute} options={header('Quiet hours')} />
          <Stack.Screen name="ProfileSetup" component={ProfileSetupRoute} />
          <Stack.Screen name="Battle" component={BattleRoute} options={header('')} />
          <Stack.Screen name="NewBattle" component={NewBattleRoute} options={NEW_CHALLENGE_SHEET} />
          <Stack.Screen name="LeagueInfo" component={LeagueInfoRoute} options={LEAGUE_INFO_SHEET} />
          <Stack.Screen name="Friends" component={FriendsRoute} options={header('Friends')} />
          <Stack.Screen name="Friend" component={FriendRoute} options={({ route }) => header(personName(route.params.friend))} />
          <Stack.Screen name="Invite" component={InviteRoute} options={header('Challenge invite')} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppStateContext.Provider>
  );
}
