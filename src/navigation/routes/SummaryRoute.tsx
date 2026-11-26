import React, { useEffect, useState } from 'react';

import { SetEndedScreen } from '../../screens/SetEndedScreen';
import { SummaryScreen } from '../../screens/SummaryScreen';
import { useBackend } from '../../backend/BackendProvider';
import { historyStore } from '../../session/useSession';
import { summaryChallengeAction } from '../../battles/challengeFromSet';
import { deviceTimeZone } from '../../backend/profile';
import { celebrate, contributionFor, formScoreForReps, localDate, phoneCountedReps, workoutFromRecord } from '../../progress';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

export function SummaryRoute({ navigation, route }: Props<'Summary'>) {
  const { enrollments, lateIds } = useAppState();
  const { appSettings, session } = useBackend();
  const record = route.params.record;
  const fromHistory = route.params.from === 'history';
  const fromSession = route.params.from === 'session' && record.reps.length > 0;
  const challenge = summaryChallengeAction(fromSession, !!session, record, {
    timedDurationsS: appSettings.asyncBattleDefaults.timedDurationsS,
    claimMaxAgeS: appSettings.asyncBattleDefaults.claimSetMaxAgeS,
  });
  const [progress, setProgress] = useState<React.ComponentProps<typeof SummaryScreen>['progress']>(null);
  useEffect(() => {
    if (fromHistory) return;
    let cancelled = false;
    historyStore.load().then((rows) => {
      if (cancelled) return;
      const records = rows.some((r) => r.id === record.id) ? rows : [record, ...rows];
      const zone = record.timeZone || deviceTimeZone();
      const today = localDate(record.startedAt, zone);
      const workouts = records.map(workoutFromRecord);
      const form = formScoreForReps(record.reps, appSettings.formScoreWeights, {
        startedAt: record.startedAt,
        timerDurationS: record.timerDurationS,
      });
      setProgress({
        counted: phoneCountedReps(record),
        shallow: record.reps.filter((r) => r.quality === 'shallow').length,
        formScore: form.score,
        tempoCaption: form.tempoCaption,
        contribution: contributionFor(workouts, enrollments, today, zone),
        celebration: celebrate(workouts, enrollments, today, zone, record.id),
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [record, enrollments, fromHistory, appSettings.formScoreWeights]);
  if (route.params.from === 'session' && record.endReason === 'tilt') {
    return (
      <Frame kind="bare">
        <SetEndedScreen
          reps={record.reps.length}
          onAgain={() => navigation.replace('Session')}
          onDone={() => navigation.popToTop()}
        />
      </Frame>
    );
  }
  return (
    <Frame kind="bare">
    <SummaryScreen
      record={record}
      fromHistory={fromHistory}
      syncedLate={lateIds.has(record.id)}
      progress={fromHistory ? null : progress}
      onChallenge={
        challenge.type === 'none'
          ? undefined
          : () => {
              if (challenge.type === 'sign-in') navigation.navigate('Settings');
              else navigation.navigate('NewBattle', { fromSet: record, offer: challenge.offer });
            }
      }
      onDone={() => (route.params.from === 'history' ? navigation.goBack() : navigation.popToTop())}
    />
    </Frame>
  );
}
