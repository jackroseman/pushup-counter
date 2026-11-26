import React, { useCallback, useEffect, useState } from 'react';

import { ProgressScreen } from '../../screens/ProgressScreen';
import { useBackend } from '../../backend/BackendProvider';
import { historyStore } from '../../session/useSession';
import { deviceTimeZone } from '../../backend/profile';
import { REFRESH_FAILED, buildProgress, localDate, signedInViews, workoutFromRecord } from '../../progress';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { TabProps } from '../types';

export function YouRoute({ navigation }: TabProps<'You'>) {
  const { enrollments, remote, refreshRemote } = useAppState();
  const { session } = useBackend();
  const [workouts, setWorkouts] = useState<ReturnType<typeof workoutFromRecord>[]>([]);
  const [storedCount, setStoredCount] = useState(0);
  const reload = useCallback(() => {
    refreshRemote();
    historyStore
      .load()
      .then((rows) => {
        setWorkouts(rows.map(workoutFromRecord));
        setStoredCount(rows.length);
      })
      .catch(() => {});
  }, [refreshRemote]);
  useEffect(() => {
    reload();
    return navigation.addListener('focus', reload);
  }, [navigation, reload]);
  const zone = deviceTimeZone();
  const today = localDate(Date.now(), zone);
  const phone = buildProgress({ workouts, enrollments, today, timeZone: zone, storedCount });
  const view = session && remote.doc && remote.status === 'ready' ? signedInViews(remote.doc, workouts).progress : phone;
  const banner = session && remote.status === 'error' ? REFRESH_FAILED : null;
  return (
    <Frame kind="tab">
    <ProgressScreen
      view={view}
      banner={banner}
      onAllSets={() => navigation.navigate('AllSets')}
      onSettings={() => navigation.navigate('Settings')}
      onProgram={() => navigation.navigate('GoalSetup')}
    />
    </Frame>
  );
}
