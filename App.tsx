import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BackendProvider } from './src/backend/BackendProvider';
import { IdentityProvider } from './src/backend/IdentityProvider';
import { RootNavigator } from './src/navigation/RootNavigator';

/** No root SafeAreaView: native headers and tabs inset themselves; other screens use `navigation/frame`. */
export default function App() {
  return (
    <SafeAreaProvider>
      <BackendProvider>
        <IdentityProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </IdentityProvider>
      </BackendProvider>
    </SafeAreaProvider>
  );
}
