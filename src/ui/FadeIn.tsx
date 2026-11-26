import React, { useState } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';

import { motionSpec, useReduceMotion } from './motion';

/**
 * Fades its content in when it appears (badge, phone-moved screen), with a small rise.
 * Reduce Motion: the same fade, no rise. `delay` staggers it after the number it belongs to.
 */
export function FadeIn({
  children,
  delay = 0,
  rise = 6,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  rise?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReduceMotion();
  const spec = motionSpec('fade', reduced);
  const [t] = useState(() => new Animated.Value(0));
  React.useEffect(() => {
    const run = Animated.timing(t, { toValue: 1, duration: spec.duration, delay, easing: spec.easing, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [t, spec.duration, spec.easing, delay]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: t },
        spec.move && rise ? { transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] } : null,
      ]}
    >
      {children}
    </Animated.View>
  );
}
