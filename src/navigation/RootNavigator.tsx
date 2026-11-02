import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, LinkingOptions, NavigationContainer, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import { TodayScreen } from '../screens/TodayScreen';
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
import { countedReps } from '../battles/counting';
import { submitBattleAttempt } from '../battles/uploader';
import { deviceTimeZone } from '../backend/profile';
import {
  GoalEnrollment,
  buildToday,
  celebrate,
  contributionFor,
  formScoreForReps,
  loadGoal,
  localDate,
  phoneCountedReps,
  saveEnrollment,
  saveGoal,
  workoutFromRecord,
} from '../progress';
import { HOWTO_KEY } from '../progress/howto';

export type RootStackParamList = {
  Today: undefined;
  GoalSetup: undefined;
  Session: { battle?: BattleSessionOptions } | undefined;
  Summary: { record: SessionRecord; from: 'session' | 'history' };
  History: undefined;
  Account: undefined;
  ProfileSetup: undefined;
  Battles: undefined;
  Battle: { battleId: string; share?: boolean; justPlayed?: { reps: number; counted: number }; promptAttempt?: boolean };
  NewBattle: { friendIds?: string[]; fromSet?: SessionRecord } | undefined;
  Friends: undefined;
  Friend: { friend: Friend };
  Invite: { token: string };
};

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
      Today: {
        path: '',
        alias: ['today'],
      },
      History: 'history',
      Account: 'account',
      Battles: 'battles',
      Friends: 'friends',
      Battle: 'battle/:battleId',
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

interface AppState {
  settings: Settings;
  updateSettings: (s: Settings) => void;
  savedSets: number;
  refreshSavedSets: () => void;
  enrollments: GoalEnrollment[];
  saveChoice: (choice: Parameters<typeof saveEnrollment>[1]) => void;
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

function TodayRoute({ navigation }: Props<'Today'>) {
  const { savedSets, refreshSavedSets, enrollments, howToOpen, openHowTo, closeHowTo } = useAppState();
  const { configured, session } = useBackend();
  const { profile } = useIdentity();
  const focused = useIsFocused();
  const askedFor = useRef<string | null>(null);
  const [workouts, setWorkouts] = useState<ReturnType<typeof workoutFromRecord>[]>([]);
  const reload = useCallback(() => {
    refreshSavedSets();
    historyStore.load().then((rows) => setWorkouts(rows.map(workoutFromRecord))).catch(() => {});
  }, [refreshSavedSets]);
  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);
  useEffect(() => {
    const uid = session?.user.id;
    if (uid && profile === null && askedFor.current !== uid && navigation.isFocused()) {
      askedFor.current = uid;
      navigation.navigate('ProfileSetup');
    }
  }, [session, profile, navigation]);
  const zone = deviceTimeZone();
  const today = localDate(Date.now(), zone);
  const view = buildToday({ workouts, enrollments, today, timeZone: zone });
  return (
    <TodayScreen
      view={view}
      depth={faceTrackingSupported()}
      showBattles={configured && faceTrackingSupported()}
      howToOpen={howToOpen && focused}
      savedSets={savedSets}
      onStart={() => navigation.navigate('Session')}
      onGoal={() => navigation.navigate('GoalSetup')}
      onHistory={() => navigation.navigate('History')}
      onAccount={() => navigation.navigate('Account')}
      onBattles={() => navigation.navigate('Battles')}
      onOpenHowTo={openHowTo}
      onCloseHowTo={closeHowTo}
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
          battleId: battle.battleId,
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

function BattlesRoute({ navigation }: Props<'Battles'>) {
  return (
    <BattlesScreen
      {...gate(navigation)}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Today'))}
      onOpen={(battleId) => navigation.navigate('Battle', { battleId })}
      onNew={() => navigation.navigate('NewBattle')}
      onFriends={() => navigation.navigate('Friends')}
    />
  );
}

function BattleRoute({ navigation, route }: Props<'Battle'>) {
  const { appSettings } = useBackend();
  const d = appSettings.asyncBattleDefaults;
  return (
    <BattleScreen
      {...gate(navigation)}
      battleId={route.params.battleId}
      share={route.params.share}
      justPlayed={route.params.justPlayed}
      promptAttempt={route.params.promptAttempt}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Battles'))}
      onPlay={(b) =>
        navigation.navigate('Session', {
          battle: {
            battleId: b.id,
            format: b.format === 'timed' ? 'timed' : 'max_reps',
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
  return (
    <NewBattleScreen
      {...gate(navigation)}
      friendIds={route.params?.friendIds}
      fromSet={route.params?.fromSet}
      onBack={() => navigation.goBack()}
      onFriends={() => navigation.navigate('Friends')}
      onCreated={(battleId, share, extras) =>
        navigation.replace('Battle', { battleId, share, promptAttempt: extras?.promptAttempt, justPlayed: extras?.justPlayed })
      }
    />
  );
}

function FriendsRoute({ navigation }: Props<'Friends'>) {
  return (
    <FriendsScreen
      {...gate(navigation)}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Battles'))}
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
      onOpenBattle={(battleId) => navigation.navigate('Battle', { battleId })}
    />
  );
}

function InviteRoute({ navigation, route }: Props<'Invite'>) {
  return (
    <InviteScreen
      {...gate(navigation)}
      token={route.params.token}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Today'))}
      onJoined={(battleId) => navigation.replace('Battle', { battleId })}
    />
  );
}

function SummaryRoute({ navigation, route }: Props<'Summary'>) {
  const { enrollments } = useAppState();
  const { appSettings } = useBackend();
  const record = route.params.record;
  const fromHistory = route.params.from === 'history';
  const canChallenge = route.params.from === 'session' && !record.battleId && record.reps.length > 0;
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
      progress={fromHistory ? null : progress}
      onChallenge={canChallenge ? () => navigation.navigate('NewBattle', { fromSet: record }) : undefined}
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
  const { settings, updateSettings } = useAppState();
  return (
    <AccountScreen
      settings={settings}
      onChangeSettings={updateSettings}
      onEditProfile={() => navigation.navigate('ProfileSetup')}
      onBack={() => navigation.goBack()}
    />
  );
}

function GoalRoute({ navigation }: Props<'GoalSetup'>) {
  const { enrollments, saveChoice } = useAppState();
  const zone = deviceTimeZone();
  return (
    <GoalSetupScreen
      enrollments={enrollments}
      today={localDate(Date.now(), zone)}
      onSave={(choice) => {
        saveChoice(choice);
        navigation.goBack();
      }}
      onClose={() => navigation.goBack()}
    />
  );
}

function ProfileSetupRoute({ navigation }: Props<'ProfileSetup'>) {
  return <ProfileSetupScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

export function RootNavigator() {
  const { appSettings } = useBackend();
  webBaseUrl = appSettings.inviteLinks.webBaseUrl;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savedSets, setSavedSets] = useState(0);
  const [enrollments, setEnrollments] = useState<GoalEnrollment[]>([]);
  const [howToOpen, setHowToOpen] = useState(false);

  useEffect(() => {
    loadSettings(AsyncStorage).then(setSettings);
    loadGoal(AsyncStorage).then(setEnrollments).catch(() => {});
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

  const enrollmentsRef = useRef(enrollments);
  enrollmentsRef.current = enrollments;
  const saveChoice = useCallback((choice: Parameters<typeof saveEnrollment>[1]) => {
    const zone = deviceTimeZone();
    const today = localDate(Date.now(), zone);
    const result = saveEnrollment(enrollmentsRef.current, choice, today, zone, `goal-${today}-${Date.now()}`);
    if (!result.ok) return;
    setEnrollments(result.enrollments);
    saveGoal(AsyncStorage, result.enrollments).catch(() => {});
  }, []);

  const closeHowTo = useCallback(() => {
    setHowToOpen(false);
    AsyncStorage.setItem(HOWTO_KEY, '1').catch(() => {});
  }, []);
  const openHowTo = useCallback(() => setHowToOpen(true), []);

  const value = useMemo(
    () => ({ settings, updateSettings, savedSets, refreshSavedSets, enrollments, saveChoice, howToOpen, openHowTo, closeHowTo }),
    [settings, updateSettings, savedSets, refreshSavedSets, enrollments, saveChoice, howToOpen, openHowTo, closeHowTo],
  );

  return (
    <AppStateContext.Provider value={value}>
      <NavigationContainer linking={linking} theme={theme}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="Today" component={TodayRoute} />
          <Stack.Screen name="GoalSetup" component={GoalRoute} />
          <Stack.Screen name="Session" component={SessionRoute} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Summary" component={SummaryRoute} />
          <Stack.Screen name="History" component={HistoryRoute} />
          <Stack.Screen name="Account" component={AccountRoute} />
          <Stack.Screen name="ProfileSetup" component={ProfileSetupRoute} />
          <Stack.Screen name="Battles" component={BattlesRoute} />
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
