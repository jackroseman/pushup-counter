import React from 'react';

import { AccountScreen } from '../../screens/AccountScreen';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

/** Was the Account screen. */
export function SettingsRoute({ navigation }: Props<'Settings'>) {
  const { settings, updateSettings, nudges, updateNudges } = useAppState();
  return (
    <Frame kind="header">
    <AccountScreen
      settings={settings}
      onChangeSettings={updateSettings}
      nudges={nudges}
      onChangeNudges={updateNudges}
      onEditProfile={() => navigation.navigate('ProfileSetup')}
      onBack={() => navigation.goBack()}
    />
    </Frame>
  );
}
