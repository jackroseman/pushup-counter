import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { SFSymbol } from 'sf-symbols-typescript';

import { ICON_PATHS, IconName } from './iconPaths';
import { color as palette } from './tokens';

export type { IconName };
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/**
 * SF Symbol used on iOS for each `IconName`. Filled vs outline follows the mockup SVGs
 * (filled glyphs such as flame and bell use `.fill`; stroke glyphs such as chevron,
 * clock and target stay unfilled). Weight is medium to match the mockup stroke weight
 * at the 13–17 pt sizes used in rows and nav buttons.
 */
export const SF_SYMBOLS = {
  flame: 'flame.fill',
  crown: 'crown.fill',
  person: 'person.fill',
  gear: 'gearshape.fill',
  chev: 'chevron.right',
  back: 'chevron.left',
  plus: 'plus',
  xmark: 'xmark',
  bell: 'bell.fill',
  people: 'person.2.fill',
  info: 'info.circle',
  check: 'checkmark',
  trophy: 'trophy',
  bolt: 'bolt.fill',
  share: 'square.and.arrow.up',
  play: 'play.fill',
  phone: 'iphone',
  speaker: 'speaker.wave.2.fill',
  face: 'face.smiling',
  chart: 'chart.bar.fill',
  clock: 'clock',
  medal: 'medal.fill',
  link: 'link',
  ellipsis: 'ellipsis',
  moon: 'moon.fill',
  calendar: 'calendar',
  target: 'target',
  arrowUp: 'arrow.up',
  team: 'person.3.fill',
  search: 'magnifyingglass',
  copy: 'doc.on.doc',
  qr: 'qrcode',
} as const satisfies Record<IconName, SFSymbol>;

function SvgIcon({
  name,
  size,
  color,
  style,
}: {
  name: IconName;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const xml = `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICON_PATHS[name].replace(/currentColor/g, color)}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

/**
 * Monochrome icon. On iOS this is an SF Symbol via `expo-symbols` `SymbolView`
 * (added in the native PR). Web and Android keep the SVG stand-ins so screenshots
 * and CI still run without the native module.
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
  const svg = <SvgIcon name={name} size={size} color={color} style={style} />;
  if (Platform.OS !== 'ios') return svg;
  return (
    <SymbolView
      name={SF_SYMBOLS[name]}
      size={size}
      tintColor={color}
      weight="medium"
      resizeMode="scaleAspectFit"
      style={style}
      fallback={svg}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
