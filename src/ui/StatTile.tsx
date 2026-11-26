import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { Card } from './Card';
import { Text } from './Text';

/** Records grid tile (You, Set details, Friend): small label, big number, optional caption. */
export function StatTile({
  label,
  value,
  caption,
  size = 34,
  align = 'left',
  compact,
  style,
}: {
  label: string;
  value: string;
  caption?: string;
  /** Number size: 34 on You, 28 in the three-up rows. */
  size?: number;
  align?: 'left' | 'center';
  /** 12 pt padding (three-up rows) instead of 14. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card
      padding={compact ? 12 : 14}
      style={[{ flex: 1, alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}
    >
      <Text variant="footnote" weight="500" accessible accessibilityLabel={`${label}: ${value}${caption ? ` ${caption}` : ''}`}>
        {label}
      </Text>
      <Text variant="hero" size={size} style={{ marginTop: size >= 34 ? 8 : 6 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" weight="400" style={{ marginTop: 4 }}>
          {caption}
        </Text>
      ) : null}
    </Card>
  );
}
