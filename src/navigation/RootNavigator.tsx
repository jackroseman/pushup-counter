import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';

import { StartScreen } from '../screens/StartScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SessionRecord } from '../storage/history';
import { DEFAULT_SETTINGS, Settings, loadSettings, saveSettings } from '../storage/settings';
import { historyStore } from '../session/useSession';
import { colors } from '../theme';
import { APP_SCHEME } from '../backend/linking';

export type RootStackParamList = {
  Start: undefined;
  Session: undefined;
  Summary: { record: SessionRecord; from: 'session' | 'history' };
  History: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), `${APP_SCHEME}://`],
  config: { screens: { Start: '', History: 'history' } },
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
  useEffect(() => navigation.addListener('focus', refreshSavedSets), [navigation, refreshSavedSets]);
  return (
    <StartScreen
      settings={settings}
      savedSets={savedSets}
      onChangeSettings={updateSettings}
      onStart={() => navigation.navigate('Session')}
      onHistory={() => navigation.navigate('History')}
    />
  );
}

function SessionRoute({ navigation }: Props<'Session'>) {
  const { settings } = useAppState();
  return (
    <SessionScreen
      settings={settings}
      onFinished={(record) => navigation.replace('Summary', { record, from: 'session' })}
      onCancel={() => navigation.goBack()}
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

export function RootNavigator() {
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
        </Stack.Navigator>
      </NavigationContainer>
    </AppStateContext.Provider>
  );
}
