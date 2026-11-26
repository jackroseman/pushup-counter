import React, { useEffect, useState } from 'react';

import { SessionScreen } from '../../screens/SessionScreen';
import { useIdentity } from '../../backend/IdentityProvider';
import { deviceTimeZone } from '../../backend/profile';
import { countedReps } from '../../battles/counting';
import { submitBattleAttempt } from '../../battles/uploader';
import { historyStore } from '../../session/useSession';
import { nextSetNumber } from '../../session/sessionView';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';

export function SessionRoute({ navigation, route }: Props<'Session'>) {
  const { settings } = useAppState();
  const { deviceId } = useIdentity();
  const battle = route.params?.battle;
  const [setNumber, setSetNumber] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    historyStore
      .load()
      .then((rows) => {
        if (!cancelled) setSetNumber(nextSetNumber(rows.map((r) => r.startedAt), Date.now(), deviceTimeZone()));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Frame kind="bare">
    <SessionScreen
      settings={settings}
      battle={battle}
      setNumber={setNumber}
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
