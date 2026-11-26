import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet, TextStyle } from 'react-native';

import { color as palette, hero, heroTrim, type, TypeVariant } from './tokens';

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

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** Negative top/bottom margins that give a big number its tight box, added to the caller's margins. */
export function trimMargins(fontSize: number, style: TextProps['style']): TextStyle {
  const f = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const t = heroTrim(fontSize);
  const top = num(f.marginTop) ?? num(f.marginVertical) ?? num(f.margin) ?? 0;
  const bottom = num(f.marginBottom) ?? num(f.marginVertical) ?? num(f.margin) ?? 0;
  return { marginTop: top - t, marginBottom: bottom - t };
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
        variant === 'hero' ? trimMargins(base.fontSize ?? 34, style) : null,
      ]}
    />
  );
}
