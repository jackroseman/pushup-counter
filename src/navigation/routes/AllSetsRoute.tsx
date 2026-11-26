import React from 'react';

import { HistoryScreen } from '../../screens/HistoryScreen';
import { Frame } from '../frame';
import type { Props } from '../types';

/** Was the History screen. */
export function AllSetsRoute({ navigation }: Props<'AllSets'>) {
  return (
    <Frame kind="header">
      <HistoryScreen onOpen={(record) => navigation.navigate('Summary', { record, from: 'history' })} />
    </Frame>
  );
}
