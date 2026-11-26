import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { SetDetailsScreen } from '../../screens/SetDetailsScreen';
import { SetEndedScreen } from '../../screens/SetEndedScreen';
import { SummaryScreen } from '../../screens/SummaryScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { summaryChallengeOffer } from '../../battles/challengeFromSet';
import { historyStore } from '../../session/useSession';
import { deviceTimeZone } from '../../backend/profile';
import { Celebration, buildToday, celebrate, localDate, mergeWorkouts, signedInViews, workoutFromRecord } from '../../progress';
import { TodayCard, todayCard } from '../../progress/summaryModel';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

/**
 * The just-finished set (frame 11, E4), the phone-moved end (frame 10), and Set details (frame 12).
 * `from: 'history'` opens Set details for a saved set (All sets rows and the summary's Set details link).
 */
export function SummaryRoute({ navigation, route }: Props<'Summary'>) {
  const { enrollments, remote } = useAppState();
  const { session, appSettings } = useBackend();
  const { deleteSet } = useIdentity();
  const record = route.params.record;
  const fromHistory = route.params.from === 'history';
  const [today, setToday] = useState<TodayCard | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const signedIn = !!session;
  const doc = remote.status === 'ready' ? remote.doc : null;
  useEffect(() => {
    if (fromHistory) return;
    let cancelled = false;
    historyStore
      .load()
      .then((rows) => {
        if (cancelled) return;
        const records = rows.some((r) => r.id === record.id) ? rows : [record, ...rows];
        const zone = deviceTimeZone();
        const day = localDate(record.startedAt, zone);
        const local = records.map(workoutFromRecord);
        // Signed in: the server's sets plus anything not backed up yet, so a new phone can't show a false "New best set".
        const view = signedIn && doc ? signedInViews(doc, local).today : buildToday({ workouts: local, enrollments, today: day, timeZone: zone });
        setToday(todayCard(view));
        if (signedIn && !doc) setCelebration(null);
        else setCelebration(celebrate(signedIn && doc ? mergeWorkouts(doc.sets, local).workouts : local, enrollments, day, zone, record.id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [record, enrollments, fromHistory, signedIn, doc]);

  if (fromHistory) {
    return (
      <Frame kind="bare">
        <SetDetailsScreen
          record={record}
          onBack={() => navigation.goBack()}
          onDelete={() => {
            deleteSet(record)
              .then((r) => {
                if (!r.ok) return Alert.alert("Can't delete this set", 'Sets played in a challenge stay in that challenge.');
                if (navigation.canGoBack()) navigation.goBack();
              })
              .catch(() => Alert.alert("Couldn't delete this set", 'Try again.'));
          }}
        />
      </Frame>
    );
  }
  if (record.endReason === 'tilt') {
    return (
      <Frame kind="bare">
        <SetEndedScreen reps={record.reps.length} onAgain={() => navigation.replace('Session')} onDone={() => navigation.popToTop()} />
      </Frame>
    );
  }
  return (
    <Frame kind="bare">
      <SummaryScreen
        record={record}
        today={today}
        celebration={celebration}
        onDone={() => navigation.popToTop()}
        onDetails={() => navigation.push('Summary', { record, from: 'history' })}
        onChallenge={
          record.reps.length > 0
            ? () =>
                navigation.navigate('NewBattle', {
                  fromSet: record,
                  offer: summaryChallengeOffer(record, {
                    timedDurationsS: appSettings.asyncBattleDefaults.timedDurationsS,
                    claimMaxAgeS: appSettings.asyncBattleDefaults.claimSetMaxAgeS,
                  }),
                })
            : undefined
        }
      />
    </Frame>
  );
}
