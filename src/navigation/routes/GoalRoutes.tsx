import React, { useState } from 'react';

import { GoalSheet } from '../../screens/GoalSheet';
import { ProfileSetupScreen } from '../../screens/ProfileSetupScreen';
import { deviceTimeZone } from '../../backend/profile';
import { localDate } from '../../progress';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

export function GoalRoute({ navigation }: Props<'GoalSetup'>) {
  const { enrollments, saveChoice } = useAppState();
  const [saving, setSaving] = useState(false);
  const [today] = useState(() => localDate(Date.now(), deviceTimeZone()));
  return (
    <Frame kind="header">
      <GoalSheet
        enrollments={enrollments}
        today={today}
        saving={saving}
        onSave={(choice) => {
          setSaving(true);
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
