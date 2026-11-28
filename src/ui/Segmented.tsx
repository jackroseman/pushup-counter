import { SegmentedControl } from '@expo/ui/community/segmented-control';
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { color } from './tokens';

export type SegmentedOption<K extends string> = { key: K; label: string };

/** Native segmented control (SwiftUI `Picker` with segmented style on iOS). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const selectedIndex = Math.max(0, options.findIndex((o) => o.key === value));
  return (
    <SegmentedControl
      values={options.map((o) => o.label)}
      selectedIndex={selectedIndex}
      onChange={(event) => {
        const option = options[event.nativeEvent.selectedSegmentIndex];
        if (option) onChange(option.key);
      }}
      appearance="dark"
      tintColor={color.fill.segmentOn}
      style={style}
    />
  );
}
