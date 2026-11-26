import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { useReduceMotion, sweepTarget } from './motion';
import { Ring } from './Ring';
import { RollingNumber } from './RollingNumber';
import { Text } from './Text';

/**
 * The 3-2-1 "Get ready" countdown (frame 8): a big number inside a thin white ring.
 * `progress` is how much of the countdown is left when this number appears (3 of 3 → full).
 * Motion: during each second the ring sweeps on to the next step (linear, 1 s), and the digit
 * rolls to the next one (180 ms). Reduce Motion: the ring jumps to each step and the digit
 * crossfades.
 */
export function Countdown({
  value,
  progress = 1,
  total = 3,
  size = 250,
  style,
}: {
  value: number;
  progress?: number;
  /** Seconds in the whole countdown. */
  total?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReduceMotion();
  const fontSize = Math.round(size * 0.64);
  return (
    <Ring
      progress={reduced ? progress : sweepTarget(value, total)}
      from={progress}
      kind="sweep"
      size={size}
      strokeWidth={4}
      style={style}
    >
      <RollingNumber
        value={value}
        distance={Math.round(fontSize * 0.13)}
        render={(v) => (
          <Text variant="hero" size={fontSize} accessibilityLiveRegion="assertive">
            {String(v)}
          </Text>
        )}
      />
    </Ring>
  );
}
