import React from 'react';

import { GoalSetupScreen } from '../../screens/GoalSetupScreen';
import { ProfileSetupScreen } from '../../screens/ProfileSetupScreen';
import { deviceTimeZone } from '../../backend/profile';
import { localDate } from '../../progress';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

export function GoalRoute({ navigation }: Props<'GoalSetup'>) {
  const { enrollments, saveChoice } = useAppState();
  const zone = deviceTimeZone();
  return (
    <Frame kind="bare">
    <GoalSetupScreen
      enrollments={enrollments}
      today={localDate(Date.now(), zone)}
      onSave={(choice) => {
        void saveChoice(choice).finally(() => navigation.goBack());
      }}
      onClose={() => navigation.goBack()}
    />
    </Frame>
  );
}

export function ProfileSetupRoute({ navigation }: Props<'ProfileSetup'>) {
  return (
    <Frame kind="bare">
      <ProfileSetupScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />
    </Frame>
  );
}
