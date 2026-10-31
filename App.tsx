import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { StartScreen } from './src/screens/StartScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SessionRecord } from './src/storage/history';
import { DEFAULT_SETTINGS, Settings, loadSettings, saveSettings } from './src/storage/settings';
import { colors } from './src/theme';

type Route =
  | { name: 'start' }
  | { name: 'session' }
  | { name: 'summary'; record: SessionRecord; from: 'session' | 'history' }
  | { name: 'history' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'start' });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadSettings(AsyncStorage).then(setSettings);
  }, []);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(AsyncStorage, s).catch(() => {});
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        {route.name === 'start' && (
          <StartScreen
            settings={settings}
            onChangeSettings={updateSettings}
            onStart={() => setRoute({ name: 'session' })}
            onHistory={() => setRoute({ name: 'history' })}
          />
        )}
        {route.name === 'session' && (
          <SessionScreen
            settings={settings}
            onFinished={(record) => setRoute({ name: 'summary', record, from: 'session' })}
            onCancel={() => setRoute({ name: 'start' })}
          />
        )}
        {route.name === 'summary' && (
          <SummaryScreen
            record={route.record}
            onDone={() => setRoute(route.from === 'history' ? { name: 'history' } : { name: 'start' })}
          />
        )}
        {route.name === 'history' && (
          <HistoryScreen
            onOpen={(record) => setRoute({ name: 'summary', record, from: 'history' })}
            onBack={() => setRoute({ name: 'start' })}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
