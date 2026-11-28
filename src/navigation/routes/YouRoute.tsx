import React, { useCallback, useEffect, useState } from 'react';

import { YouScreen } from '../../screens/YouScreen';
import { supabase } from '../../backend/supabase';
import { api } from '../../battles/api';
import type { MyChallengeRecord } from '../../battles/openChallenges';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { isAppleSignInAvailable, signInWithApple } from '../../backend/auth';
import { historyStore } from '../../session/useSession';
import { deviceTimeZone } from '../../backend/profile';
import { REFRESH_FAILED, buildProgress, goalForDate, localDate, mergeWorkouts, signedInViews, workoutFromRecord } from '../../progress';
import { formatSinceMonth } from '../../progress/format';
import { buildYou } from '../../progress/you';
import type { SessionRecord } from '../../storage/history';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { TabProps } from '../types';
import { useFocusNow } from './useFocusNow';

export function YouRoute({ navigation, route }: TabProps<'You'>) {
  const { enrollments, remote, refreshRemote } = useAppState();
  const { configured, session } = useBackend();
  const { profile } = useIdentity();
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  const [challengeRecord, setChallengeRecord] = useState<MyChallengeRecord | null>(null);
  const segment = route.params?.segment === 'challenges' ? 'challenges' : 'sets';
  const reload = useCallback(() => {
    refreshRemote();
    historyStore
      .load()
      .then(setRecords)
      .catch(() => {});
    if (supabase) {
      api.myChallengeRecord(supabase).then((r) => {
        if (r.ok) setChallengeRecord(r.data);
      });
    }
  }, [refreshRemote]);
  useEffect(() => {
    reload();
    return navigation.addListener('focus', reload);
  }, [navigation, reload]);
  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const zone = deviceTimeZone();
  const nowMs = useFocusNow(navigation);
  const today = localDate(nowMs, zone);
  const workouts = records.map(workoutFromRecord);
  const doc = session && remote.doc && remote.status === 'ready' ? remote.doc : null;
  const view = doc ? signedInViews(doc, workouts).progress : buildProgress({ workouts, enrollments, today, timeZone: zone, storedCount: records.length });
  const merged = doc ? mergeWorkouts(doc.sets, workouts).workouts : workouts;
  const lifetimeReps = merged.reduce((sum, w) => sum + w.countedReps, 0);
  const model = buildYou({
    view,
    lifetimeReps,
    setCount: merged.length,
    hasGoal: goalForDate(enrollments, today) != null,
    recent: records.map((r) => ({ id: r.id, startedAt: r.startedAt, reps: workoutFromRecord(r).countedReps })),
    nowMs,
    timeZone: zone,
  });

  const since = session?.user.created_at ? ` · ${formatSinceMonth(session.user.created_at, nowMs, zone)}` : '';
  const identity = session && profile ? { name: profile.displayName || profile.username, line: `@${profile.username}${since}` } : null;
  const signIn =
    !session && configured && appleAvailable
      ? {
          message: signInMessage,
          onPress: async () => {
            setSignInMessage(null);
            const r = await signInWithApple();
            if (!r.ok && !r.cancelled) setSignInMessage(r.message ?? 'Sign-in failed.');
          },
        }
      : null;

  return (
    <Frame kind="tab">
      <YouScreen
        model={model}
        identity={identity}
        signIn={signIn}
        pickUsername={session && profile === null ? () => navigation.navigate('ProfileSetup') : null}
        banner={session && remote.status === 'error' ? REFRESH_FAILED : null}
        timeZone={zone}
        nowMs={nowMs}
        onSettings={() => navigation.navigate('Settings')}
        onSetGoal={() => navigation.navigate('GoalSetup')}
        onStartSet={() => navigation.navigate('Session')}
        onAllSets={() => navigation.navigate('AllSets')}
        segment={segment}
        onSegment={(key) => navigation.setParams({ segment: key })}
        challengeRecord={challengeRecord}
        onOpenChallenge={(id) => navigation.navigate('Battle', { challengeId: id })}
        onOpenSet={(id) => {
          const record = records.find((r) => r.id === id);
          if (record) navigation.navigate('Summary', { record, from: 'history' });
        }}
      />
    </Frame>
  );
}
