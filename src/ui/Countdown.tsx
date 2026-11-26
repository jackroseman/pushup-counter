import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { Ring } from './Ring';
import { Text } from './Text';

/**
 * The 3-2-1 "Get ready" countdown (frame 8): a big number inside a thin white ring that sweeps
 * as the second runs out. `progress` is how much of the current second is left (0–1).
 * The sweep animation is added in the motion PR; this is the static view.
 */
export function Countdown({
  value,
  progress = 1,
  size = 250,
  style,
}: {
  value: number;
  progress?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Ring progress={progress} size={size} strokeWidth={4} style={style}>
      <Text variant="hero" size={Math.round(size * 0.64)} accessibilityLiveRegion="assertive">
        {String(value)}
      </Text>
    </Ring>
  );
}
