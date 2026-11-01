import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import { StartScreen } from '../screens/StartScreen';
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

export type RootStackParamList = {
  Start: undefined;
  Session: { battle?: BattleSessionOptions } | undefined;
  Summary: { record: SessionRecord; from: 'session' | 'history' };
  History: undefined;
  Account: undefined;
  ProfileSetup: undefined;
  Battles: undefined;
  Battle: { battleId: string; share?: boolean; justPlayed?: { reps: number; counted: number } };
  NewBattle: { friendIds?: string[] } | undefined;
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
      Start: '',
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
}

const AppStateContext = createContext<AppState | null>(null);
const useAppState = () => {
  const s = useContext(AppStateContext);
  if (!s) throw new Error('AppStateContext missing');
  return s;
};

function StartRoute({ navigation }: Props<'Start'>) {
  const { settings, updateSettings, savedSets, refreshSavedSets } = useAppState();
  const { session } = useBackend();
  const { profile } = useIdentity();
  const askedFor = useRef<string | null>(null);
  useEffect(() => navigation.addListener('focus', refreshSavedSets), [navigation, refreshSavedSets]);
  // Right after the first sign-in: ask for a username once per app run ("Later" is fine).
  useEffect(() => {
    const uid = session?.user.id;
    if (uid && profile === null && askedFor.current !== uid && navigation.isFocused()) {
      askedFor.current = uid;
      navigation.navigate('ProfileSetup');
    }
  }, [session, profile, navigation]);
  return (
    <StartScreen
      settings={settings}
      savedSets={savedSets}
      onChangeSettings={updateSettings}
      onStart={() => navigation.navigate('Session')}
      onHistory={() => navigation.navigate('History')}
      onAccount={() => navigation.navigate('Account')}
      onBattles={() => navigation.navigate('Battles')}
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
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Start'))}
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
      onBack={() => navigation.goBack()}
      onFriends={() => navigation.navigate('Friends')}
      onCreated={(battleId, share) => navigation.replace('Battle', { battleId, share })}
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
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Start'))}
      onJoined={(battleId) => navigation.replace('Battle', { battleId })}
    />
  );
}

function SummaryRoute({ navigation, route }: Props<'Summary'>) {
  return (
    <SummaryScreen
      record={route.params.record}
      fromHistory={route.params.from === 'history'}
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
  return <AccountScreen onEditProfile={() => navigation.navigate('ProfileSetup')} onBack={() => navigation.goBack()} />;
}

function ProfileSetupRoute({ navigation }: Props<'ProfileSetup'>) {
  return <ProfileSetupScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

export function RootNavigator() {
  const { appSettings } = useBackend();
  webBaseUrl = appSettings.inviteLinks.webBaseUrl;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savedSets, setSavedSets] = useState(0);

  useEffect(() => {
    loadSettings(AsyncStorage).then(setSettings);
  }, []);

  const refreshSavedSets = useCallback(() => {
    historyStore.load().then((h) => setSavedSets(h.length)).catch(() => {});
  }, []);

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(AsyncStorage, s).catch(() => {});
  }, []);

  const value = useMemo(() => ({ settings, updateSettings, savedSets, refreshSavedSets }), [settings, updateSettings, savedSets, refreshSavedSets]);

  return (
    <AppStateContext.Provider value={value}>
      <NavigationContainer linking={linking} theme={theme}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="Start" component={StartRoute} />
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
