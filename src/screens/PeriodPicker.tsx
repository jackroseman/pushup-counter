import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import type { ChallengeRecordPeriod } from '../battles/openChallenges';
import { MenuPicker } from '../ui/MenuPicker';

/** Period control for You > Challenges and the friend page. Options and ranges come from the RPC. */
export function PeriodPicker({
  periods,
  selected,
  onChange,
  style,
}: {
  periods: readonly ChallengeRecordPeriod[];
  selected: ChallengeRecordPeriod | null;
  onChange: (period: ChallengeRecordPeriod) => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (!periods.length && !selected) return null;
  const label = selected?.label ?? 'Last 30 days';
  const value = selected?.key ?? periods[0]?.key;
  if (!value) return null;
  return (
    <MenuPicker
      options={periods.map((p) => ({ key: p.key, label: p.label }))}
      value={value}
      onChange={(key) => {
        const period = periods.find((p) => p.key === key);
        if (period) onChange(period);
      }}
      accessibilityLabel={`Period: ${label}`}
      style={style}
    />
  );
}
