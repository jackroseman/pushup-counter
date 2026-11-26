import React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';

import { color as palette, hero, type, TypeVariant } from './tokens';

export type TextTone = 'label' | 'secondary' | 'tertiary' | 'signal' | 'destructive';

/** Default tone per variant, as in the mockups: subhead/footnote secondary, caption tertiary. */
const DEFAULT_TONE: Partial<Record<TypeVariant, TextTone>> = {
  subhead: 'secondary',
  footnote: 'secondary',
  caption: 'tertiary',
};

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  /** A palette tone, or any color string. */
  tone?: TextTone | (string & {});
  /** Size for the `hero` variant (28–150 pt). */
  size?: number;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
  tabular?: boolean;
};

export function toneColor(tone: TextTone | (string & {})): string {
  return tone in palette ? (palette as unknown as Record<string, string>)[tone] : tone;
}

export function Text({ variant = 'body', tone, size, weight, align, tabular, style, ...rest }: TextProps) {
  const base = variant === 'hero' ? hero(size ?? 34) : type[variant];
  const c = toneColor(tone ?? DEFAULT_TONE[variant] ?? 'label');
  return (
    <RNText
      {...rest}
      style={[
        base,
        { color: c },
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}
