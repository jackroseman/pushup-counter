import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { ICON_PATHS, IconName } from './iconPaths';
import { color as palette } from './tokens';

export type { IconName };
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/**
 * Monochrome icon. SVG stand-ins for SF Symbols for now; switches to `expo-symbols` SymbolView
 * after the native PR (plan PR 4 / PR 13). Decorative by default (hidden from VoiceOver).
 */
export function Icon({
  name,
  size = 22,
  color = palette.label,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const xml = `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICON_PATHS[name].replace(/currentColor/g, color)}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
