import React from 'react';

import { SessionScreen } from '../../screens/SessionScreen';
import { useIdentity } from '../../backend/IdentityProvider';
import { countedReps } from '../../battles/counting';
import { submitBattleAttempt } from '../../battles/uploader';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

export function SessionRoute({ navigation, route }: Props<'Session'>) {
  const { settings } = useAppState();
  const { deviceId } = useIdentity();
  const battle = route.params?.battle;
  return (
    <Frame kind="bare">
    <SessionScreen
      settings={settings}
      battle={battle}
      onFinished={(record) => {
        if (!battle) return navigation.replace('Summary', { record, from: 'session' });
        submitBattleAttempt(record, battle.battleId, deviceId).catch(() => {});
        navigation.replace('Battle', {
          challengeId: battle.battleId,
          justPlayed: {
            reps: record.reps.length,
            counted: countedReps(record.reps, record.startedAt, battle),
            ...(record.endReason === 'tilt' ? { phoneMoved: true } : {}),
          },
        });
      }}
      onCancel={() => navigation.goBack()}
    />
    </Frame>
  );
}
