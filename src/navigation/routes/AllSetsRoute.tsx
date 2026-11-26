import React, { useCallback, useEffect, useState } from 'react';

import { AllSetsScreen } from '../../screens/AllSetsScreen';
import { deviceTimeZone } from '../../backend/profile';
import { historyStore } from '../../session/useSession';
import type { SessionRecord } from '../../storage/history';
import { Frame } from '../frame';
import type { Props } from '../types';

/** Was the History screen. Reloads on focus so a deleted set disappears. */
export function AllSetsRoute({ navigation }: Props<'AllSets'>) {
  const [records, setRecords] = useState<SessionRecord[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => {
    historyStore.load().then(
      (rows) => {
        setNow(Date.now());
        setRecords(rows);
      },
      () => setRecords([])
    );
  }, []);
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);
  return (
    <Frame kind="header">
      <AllSetsScreen
        records={records}
        now={now}
        timeZone={deviceTimeZone()}
        onOpen={(record) => navigation.navigate('Summary', { record, from: 'history' })}
        onStart={() => navigation.navigate('Session')}
      />
    </Frame>
  );
}
