import React from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { BackendProvider } from './src/backend/BackendProvider';
import { IdentityProvider } from './src/backend/IdentityProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <BackendProvider>
        <IdentityProvider>
          <SafeAreaView style={styles.root}>
            <StatusBar style="light" />
            <RootNavigator />
          </SafeAreaView>
        </IdentityProvider>
      </BackendProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
