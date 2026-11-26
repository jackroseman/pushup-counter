import React, { useEffect, useLayoutEffect, useState } from 'react';

import { GoalSheet } from '../../screens/GoalSheet';
import { ProfileSetupScreen, useProfileForm } from '../../screens/ProfileSetupScreen';
import { deviceTimeZone } from '../../backend/profile';
import { localDate } from '../../progress';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import { header } from '../headerOptions';
import { useDiscardGuard, useSaveHeader } from '../draft';
import type { Props } from '../types';

export function GoalRoute({ navigation }: Props<'GoalSetup'>) {
  const { enrollments, saveChoice } = useAppState();
  const [today] = useState(() => localDate(Date.now(), deviceTimeZone()));
  return (
    <Frame kind="header">
      <GoalSheet enrollments={enrollments} today={today} onSave={saveChoice} onClose={() => navigation.goBack()} />
    </Frame>
  );
}

/** Username screen. First time: Continue / Later. Editing: a draft with a native Save button and the Discard prompt. */
export function ProfileSetupRoute({ navigation }: Props<'ProfileSetup'>) {
  const [leaving, setLeaving] = useState(false);
  const form = useProfileForm({ onDone: () => setLeaving(true) });
  const leave = useDiscardGuard(navigation, form.editing && form.dirty && !leaving);
  useEffect(() => {
    if (leaving) leave();
  }, [leaving, leave]);
  useLayoutEffect(() => {
    if (form.editing) navigation.setOptions(header('Edit profile'));
  }, [form.editing, navigation]);
  useSaveHeader(navigation, { canSave: form.editing && form.canSave, saving: form.saving, onSave: form.save });
  return (
    <Frame kind={form.editing ? 'header' : 'bare'}>
      <ProfileSetupScreen form={form} onCancel={() => navigation.goBack()} />
    </Frame>
  );
}
