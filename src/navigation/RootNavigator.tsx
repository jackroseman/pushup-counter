import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as AppLifecycle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CompositeScreenProps, DarkTheme, LinkingOptions, NavigationContainer, NavigatorScreenParams, useIsFocused } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import { TodayScreen } from '../screens/TodayScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { LeagueScreen } from '../screens/LeagueScreen';
import { GoalSetupScreen } from '../screens/GoalSetupScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { ProfileSetupScreen } from '../screens/ProfileSetupScreen';
import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import { SessionRecord } from '../storage/history';
import { DEFAULT_SETTINGS, Settings, loadSettings, saveSettings } from '../storage/settings';
import { historyStore } from '../session/useSession';
import { faceTrackingSupported } from '../sensors';
import { colors } from '../theme';
import { APP_SCHEME, notificationLink, parseAppLink } from '../backend/linking';
import { BattlesScreen } from '../screens/battles/BattlesScreen';
import { BattleScreen } from '../screens/battles/BattleScreen';
import { NewBattleScreen } from '../screens/battles/NewBattleScreen';
import { FriendsScreen } from '../screens/battles/FriendsScreen';
import { FriendScreen } from '../screens/battles/FriendScreen';
import { InviteScreen } from '../screens/battles/InviteScreen';
import type { BattleSessionOptions } from '../session/useSession';
import type { Friend } from '../battles/model';
import { challengeOffers, type ChallengeOffer } from '../battles/challengeFromSet';
import { countedReps } from '../battles/counting';
import { submitBattleAttempt } from '../battles/uploader';
import { deviceTimeZone } from '../backend/profile';
import { enrollGoal, fetchMyProgress } from '../backend/progressClient';
import { fetchMyLeague, loadLeagueCache, saveLeagueCache, type LeagueBoard } from '../backend/leagueClient';
import { fetchNotificationPrefs, fetchRecapRanks, saveNotificationPrefs } from '../backend/nudgeClient';
import { onHistoryChanged } from '../backend/syncEvents';
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
  REFRESH_FAILED,
  WeekRanks,
  ServerProgress,
  buildProgress,
  buildToday,
  celebrate,
  contributionFor,
  decideGoalSync,
  decideNudgeSync,
  enrollmentsFromServer,
  formScoreForReps,
  goalSnapshot,
  goalSyncSettled,
  lateSetIds,
  goalForDate,
  loadGoal,
  loadNudges,
  localDate,
  nextLocalReminder,
  phoneCountedReps,
  queueGoalEdit,
  sanitizeGoalSync,
  sanitizeNudgeSync,
  saveEnrollment,
  saveGoal,
  saveNudges,
  weekCard,
  workoutDate,
  signedInViews,
  workoutFromRecord,
} from '../progress';
import { HOWTO_KEY } from '../progress/howto';

export type TabParamList = {
  Today: undefined;
  Progress: undefined;
  League: undefined;
  Challenges: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  GoalSetup:
    | {
        /** After a save, open New challenge. Otherwise return to the screen underneath. */
        next?: 'new';
        offer?: ChallengeOffer;
        fromSet?: SessionRecord;
        friendIds?: string[];
      }
    | undefined;
  Session: { battle?: BattleSessionOptions } | undefined;
  Summary: { record: SessionRecord; from: 'session' | 'history' };
  History: undefined;
  Account: undefined;
  ProfileSetup: undefined;
  Battle: { challengeId: string; share?: boolean; justPlayed?: { reps: number; counted: number }; promptAttempt?: boolean };
  NewBattle: { friendIds?: string[]; fromSet?: SessionRecord; offer?: ChallengeOffer } | undefined;
  Friends: undefined;
  Friend: { friend: Friend };
  Invite: { token: string };
};

const Tabs = createBottomTabNavigator<TabParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Web invite links (https://<domain>/b/<token>, once a domain exists) are mapped to the scheme form. */
let webBaseUrl: string | null = null;
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
  config: {
    screens: {
      Main: {
        screens: {
          Today: {
            path: '',
            alias: ['today'],
          },
          Progress: 'progress',
          League: 'league',
          Challenges: {
            path: 'challenges',
            alias: ['battles'],
          },
        },
      },
      History: 'history',
      Account: 'account',
      Friends: 'friends',
      Battle: {
        path: 'challenge/:challengeId',
        alias: ['battle/:challengeId'],
      },
      Invite: 'invite/:token',
    },
  },
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

type Props<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
type TabProps<T extends keyof TabParamList> = CompositeScreenProps<BottomTabScreenProps<TabParamList, T>, NativeStackScreenProps<RootStackParamList>>;

interface RemoteProgress {
  doc: ServerProgress | null;
  status: 'idle' | 'ready' | 'error';
}

interface AppState {
  settings: Settings;
  updateSettings: (s: Settings) => void;
  nudges: NudgePrefs;
  updateNudges: (prefs: NudgePrefs) => void;
  savedSets: number;
  refreshSavedSets: () => void;
  enrollments: GoalEnrollment[];
  saveChoice: (choice: Parameters<typeof saveEnrollment>[1]) => Promise<void>;
  remote: RemoteProgress;
  lateIds: ReadonlySet<string>;
  refreshRemote: () => void;
  howToOpen: boolean;
  openHowTo: () => void;
  closeHowTo: () => void;
}

const AppStateContext = createContext<AppState | null>(null);
const useAppState = () => {
  const s = useContext(AppStateContext);
  if (!s) throw new Error('AppStateContext missing');
  return s;
};

function TodayRoute({ navigation }: TabProps<'Today'>) {
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
    <TodayScreen
      view={view}
      banner={banner}
      week={week}
      depth={faceTrackingSupported()}
      howToOpen={howToOpen && focused}
      savedSets={savedSets}
      onStart={() => navigation.navigate('Session')}
      onGoal={() => navigation.navigate('GoalSetup')}
      onAccount={() => navigation.navigate('Account')}
      onWeek={week ? () => navigation.navigate(week.destination === 'league' ? 'League' : 'Progress') : undefined}
      onOpenHowTo={openHowTo}
      onCloseHowTo={closeHowTo}
    />
  );
}

function LeagueRoute({ navigation }: TabProps<'League'>) {
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

function ProgressRoute({ navigation }: TabProps<'Progress'>) {
  const { enrollments, remote, refreshRemote } = useAppState();
  const { session } = useBackend();
  const [workouts, setWorkouts] = useState<ReturnType<typeof workoutFromRecord>[]>([]);
  const [storedCount, setStoredCount] = useState(0);
  const reload = useCallback(() => {
    refreshRemote();
    historyStore
      .load()
      .then((rows) => {
        setWorkouts(rows.map(workoutFromRecord));
        setStoredCount(rows.length);
      })
      .catch(() => {});
  }, [refreshRemote]);
  useEffect(() => {
    reload();
    return navigation.addListener('focus', reload);
  }, [navigation, reload]);
  const zone = deviceTimeZone();
  const today = localDate(Date.now(), zone);
  const phone = buildProgress({ workouts, enrollments, today, timeZone: zone, storedCount });
  const view = session && remote.doc && remote.status === 'ready' ? signedInViews(remote.doc, workouts).progress : phone;
  const banner = session && remote.status === 'error' ? REFRESH_FAILED : null;
  return (
    <ProgressScreen
      view={view}
      banner={banner}
      onAllSets={() => navigation.navigate('History')}
      onProgram={() => navigation.navigate('GoalSetup')}
    />
  );
}

function SessionRoute({ navigation, route }: Props<'Session'>) {
  const { settings } = useAppState();
  const { deviceId } = useIdentity();
  const battle = route.params?.battle;
  return (
    <SessionScreen
      settings={settings}
      battle={battle}
      onFinished={(record) => {
        if (!battle) return navigation.replace('Summary', { record, from: 'session' });
        submitBattleAttempt(record, battle.battleId, deviceId).catch(() => {});
        navigation.replace('Battle', {
          challengeId: battle.battleId,
          justPlayed: { reps: record.reps.length, counted: countedReps(record.reps, record.startedAt, battle) },
        });
      }}
      onCancel={() => navigation.goBack()}
    />
  );
}

const gate = (navigation: { navigate: (r: 'Account' | 'ProfileSetup') => void }) => ({
  onAccount: () => navigation.navigate('Account'),
  onProfile: () => navigation.navigate('ProfileSetup'),
});

function BattlesRoute({ navigation }: TabProps<'Challenges'>) {
  return (
    <BattlesScreen
      {...gate(navigation)}
      onOpen={(challengeId) => navigation.navigate('Battle', { challengeId })}
      onNew={() => navigation.navigate('NewBattle')}
      onFriends={() => navigation.navigate('Friends')}
    />
  );
}

function openGoal(enrollments: { endedOn: string | null }[]): boolean {
  return enrollments.some((row) => row.endedOn === null);
}

function BattleRoute({ navigation, route }: Props<'Battle'>) {
  const { appSettings } = useBackend();
  const { enrollments } = useAppState();
  const d = appSettings.asyncBattleDefaults;
  return (
    <BattleScreen
      {...gate(navigation)}
      battleId={route.params.challengeId}
      share={route.params.share}
      justPlayed={route.params.justPlayed}
      promptAttempt={route.params.promptAttempt}
      hasGoal={openGoal(enrollments)}
      onNeedGoal={() => navigation.navigate('GoalSetup')}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Challenges' }))}
      onPlay={(b) =>
        navigation.navigate('Session', {
          battle: {
            battleId: b.id,
            format: b.durationS ? 'timed' : 'max_reps',
            durationS: b.durationS,
            idleEndS: d.maxRepsIdleEndS,
            capS: d.maxRepsCapS,
          },
        })
      }
    />
  );
}

function NewBattleRoute({ navigation, route }: Props<'NewBattle'>) {
  const { enrollments } = useAppState();
  return (
    <NewBattleScreen
      {...gate(navigation)}
      friendIds={route.params?.friendIds}
      fromSet={route.params?.fromSet}
      offer={route.params?.offer}
      hasGoal={openGoal(enrollments)}
      onNeedGoal={() => navigation.navigate('GoalSetup')}
      onBack={() => navigation.goBack()}
      onFriends={() => navigation.navigate('Friends')}
      onCreated={(challengeId, share, extras) =>
        navigation.replace('Battle', { challengeId, share, promptAttempt: extras?.promptAttempt, justPlayed: extras?.justPlayed })
      }
    />
  );
}

function FriendsRoute({ navigation }: Props<'Friends'>) {
  return (
    <FriendsScreen
      {...gate(navigation)}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Challenges' }))}
      onOpenFriend={(friend) => navigation.navigate('Friend', { friend })}
    />
  );
}

function FriendRoute({ navigation, route }: Props<'Friend'>) {
  return (
    <FriendScreen
      {...gate(navigation)}
      friend={route.params.friend}
      onBack={() => navigation.goBack()}
      onChallenge={(f) => navigation.navigate('NewBattle', { friendIds: [f.userId] })}
      onOpenBattle={(challengeId) => navigation.navigate('Battle', { challengeId })}
    />
  );
}

function InviteRoute({ navigation, route }: Props<'Invite'>) {
  const { enrollments } = useAppState();
  return (
    <InviteScreen
      {...gate(navigation)}
      token={route.params.token}
      hasGoal={openGoal(enrollments)}
      onNeedGoal={() => navigation.navigate('GoalSetup')}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Today' }))}
      onJoined={(challengeId) => navigation.replace('Battle', { challengeId })}
    />
  );
}

function SummaryRoute({ navigation, route }: Props<'Summary'>) {
  const { enrollments, lateIds } = useAppState();
  const { appSettings, session } = useBackend();
  const record = route.params.record;
  const fromHistory = route.params.from === 'history';
  const fromSession = route.params.from === 'session' && record.reps.length > 0;
  const offers = fromSession && session
    ? challengeOffers(record, {
        timedDurationsS: appSettings.asyncBattleDefaults.timedDurationsS,
        claimMaxAgeS: appSettings.asyncBattleDefaults.claimSetMaxAgeS,
      })
    : undefined;
  const [progress, setProgress] = useState<React.ComponentProps<typeof SummaryScreen>['progress']>(null);
  useEffect(() => {
    if (fromHistory) return;
    let cancelled = false;
    historyStore.load().then((rows) => {
      if (cancelled) return;
      const records = rows.some((r) => r.id === record.id) ? rows : [record, ...rows];
      const zone = record.timeZone || deviceTimeZone();
      const today = localDate(record.startedAt, zone);
      const workouts = records.map(workoutFromRecord);
      const form = formScoreForReps(record.reps, appSettings.formScoreWeights, {
        startedAt: record.startedAt,
        timerDurationS: record.timerDurationS,
      });
      setProgress({
        counted: phoneCountedReps(record),
        shallow: record.reps.filter((r) => r.quality === 'shallow').length,
        formScore: form.score,
        tempoCaption: form.tempoCaption,
        contribution: contributionFor(workouts, enrollments, today, zone),
        celebration: celebrate(workouts, enrollments, today, zone, record.id),
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [record, enrollments, fromHistory, appSettings.formScoreWeights]);
  return (
    <SummaryScreen
      record={record}
      fromHistory={fromHistory}
      syncedLate={lateIds.has(record.id)}
      progress={fromHistory ? null : progress}
      offers={offers}
      onPickChallenge={
        offers
          ? (offer) => {
              if (offer.kind === 'streak' && !openGoal(enrollments)) {
                navigation.navigate('GoalSetup', { next: 'new', offer, fromSet: record });
              } else {
                navigation.navigate('NewBattle', { fromSet: record, offer });
              }
            }
          : undefined
      }
      onSignIn={fromSession && !session ? () => navigation.navigate('Account') : undefined}
      onDone={() => (route.params.from === 'history' ? navigation.goBack() : navigation.popToTop())}
    />
  );
}

function HistoryRoute({ navigation }: Props<'History'>) {
  return (
    <HistoryScreen onOpen={(record) => navigation.navigate('Summary', { record, from: 'history' })} onBack={() => navigation.goBack()} />
  );
}

function AccountRoute({ navigation }: Props<'Account'>) {
  const { settings, updateSettings, nudges, updateNudges } = useAppState();
  return (
    <AccountScreen
      settings={settings}
      onChangeSettings={updateSettings}
      nudges={nudges}
      onChangeNudges={updateNudges}
      onEditProfile={() => navigation.navigate('ProfileSetup')}
      onBack={() => navigation.goBack()}
    />
  );
}

function GoalRoute({ navigation, route }: Props<'GoalSetup'>) {
  const { enrollments, saveChoice } = useAppState();
  const zone = deviceTimeZone();
  return (
    <GoalSetupScreen
      enrollments={enrollments}
      today={localDate(Date.now(), zone)}
      onSave={(choice) => {
        void saveChoice(choice).finally(() => {
          if (route.params?.next === 'new') {
            navigation.replace('NewBattle', {
              offer: route.params.offer,
              fromSet: route.params.fromSet,
              friendIds: route.params.friendIds,
            });
          } else {
            navigation.goBack();
          }
        });
      }}
      onClose={() => navigation.goBack()}
    />
  );
}

function ProfileSetupRoute({ navigation }: Props<'ProfileSetup'>) {
  return <ProfileSetupScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: '#2A3145' },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="Today" component={TodayRoute} />
      <Tabs.Screen name="Progress" component={ProgressRoute} />
      <Tabs.Screen name="League" component={LeagueRoute} />
      <Tabs.Screen name="Challenges" component={BattlesRoute} />
    </Tabs.Navigator>
  );
}

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
  const [howToOpen, setHowToOpen] = useState(false);
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
    AsyncStorage.getItem(HOWTO_KEY)
      .then((v) => setHowToOpen(v !== '1'))
      .catch(() => setHowToOpen(true));
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

  const closeHowTo = useCallback(() => {
    setHowToOpen(false);
    AsyncStorage.setItem(HOWTO_KEY, '1').catch(() => {});
  }, []);
  const openHowTo = useCallback(() => setHowToOpen(true), []);

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
      howToOpen,
      openHowTo,
      closeHowTo,
    }),
    [settings, updateSettings, nudges, updateNudges, savedSets, refreshSavedSets, enrollments, saveChoice, remote, lateIds, refreshRemote, howToOpen, openHowTo, closeHowTo],
  );

  return (
    <AppStateContext.Provider value={value}>
      <NavigationContainer linking={linking} theme={theme}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="GoalSetup" component={GoalRoute} />
          <Stack.Screen name="Session" component={SessionRoute} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Summary" component={SummaryRoute} />
          <Stack.Screen name="History" component={HistoryRoute} />
          <Stack.Screen name="Account" component={AccountRoute} />
          <Stack.Screen name="ProfileSetup" component={ProfileSetupRoute} />
          <Stack.Screen name="Battle" component={BattleRoute} />
          <Stack.Screen name="NewBattle" component={NewBattleRoute} />
          <Stack.Screen name="Friends" component={FriendsRoute} />
          <Stack.Screen name="Friend" component={FriendRoute} />
          <Stack.Screen name="Invite" component={InviteRoute} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppStateContext.Provider>
  );
}
