import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';

import { color } from '../../ui/tokens';

/** The RR monogram under a thin crown line (brand board, frame 1): 124 pt black tile with a hairline border and a white mark (Welcome). */
export function BrandMark({ style, size = 124 }: { style?: StyleProp<ViewStyle>; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style} accessibilityLabel="Rep Royale">
      <Rect width={120} height={120} rx={27} fill={color.bg} />
      <Rect x={0.75} y={0.75} width={118.5} height={118.5} rx={26.5} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
      <Path d="M33 42l13 8 14-15 14 15 13-8" stroke={color.label} strokeWidth={3.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <SvgText x={60} y={86} textAnchor="middle" fontWeight="800" fontSize={36} letterSpacing={-1.5} fill={color.label}>
        RR
      </SvgText>
    </Svg>
  );
}
