/**
 * Rep Royale design tokens (Direction A, "Monochrome Precision"). Dark only.
 * Source of truth: docs/rebrand/IMPLEMENTATION_PLAN.md §1 and the mockup frames in docs/rebrand/frames.
 * Screens should import from here (or from `src/ui`), never hard-code colors or sizes.
 */
import { Easing, TextStyle } from 'react-native';

import type { RepQuality } from '../core';

const palette = {
  bg: '#000000',
  surface: '#111113',
  elevated: '#1C1C1E',
  graphite: '#2C2C2E',
  separator: 'rgba(255,255,255,0.10)',
  label: '#FFFFFF',
  secondary: 'rgba(235,235,245,0.60)',
  tertiary: 'rgba(235,235,245,0.30)',
  signal: '#30D158',
  destructive: '#FF453A',
} as const;

export const color = {
  ...palette,
  /** Rep quality: full = signal, good = label, shallow = graphite. */
  quality: {
    full: palette.signal,
    good: palette.label,
    shallow: palette.graphite,
  } satisfies Record<RepQuality, string>,
  /** Translucent fills used by the mockups (frames/*.png). */
  fill: {
    /** Tinted buttons and circular nav-bar buttons. */
    tinted: 'rgba(255,255,255,0.10)',
    /** Neutral pills. */
    pill: 'rgba(255,255,255,0.08)',
    /** Ring track. */
    ringTrack: 'rgba(255,255,255,0.12)',
    /** Signal-tinted pills and bars. */
    signalSoft: 'rgba(48,209,88,0.14)',
    /** Segmented control track and selected segment. */
    segmentTrack: 'rgba(118,118,128,0.24)',
    segmentOn: '#5A5A5E',
    /** Switch track when off. */
    switchOff: 'rgba(120,120,128,0.32)',
    /** Sheet grabber. */
    grabber: 'rgba(255,255,255,0.25)',
    /** Pressed list row. */
    pressed: 'rgba(255,255,255,0.06)',
    /** Dim behind sheets. */
    scrim: 'rgba(0,0,0,0.55)',
  },
} as const;

export type ColorName = keyof typeof palette;

/** System font (SF Pro; iOS switches to SF Pro Display at 20 pt and up). */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** Big numbers (28–150 pt). Pass the size with `hero(size)`. */
  hero: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  /** The in-set rep counter: regular SF Pro Display Bold, no condensed face, no font files. */
  counter: { fontSize: 180, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -4 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const HERO_MIN = 28;
export const HERO_MAX = 150;

/** Big numbers sit on a tight line box (0.92 of the size), as in the mockup frames. */
export const HERO_LINE = 0.92;
/** SF Pro's natural line height (ascender + descender) as a share of the font size. */
export const SF_LINE = 1.19;

/**
 * How much to pull a big number in at the top and at the bottom so its box is HERO_LINE × size
 * without clipping. A lineHeight below the font's own line height cuts off the top of the
 * glyphs on iOS, so big numbers use the full line height and use negative margins instead
 * (the same box and glyph position as CSS line-height 0.92 in the mockups).
 */
export function heroTrim(fontSize: number): number {
  return Math.round((fontSize * (SF_LINE - HERO_LINE)) / 2);
}

/** The full (unclipped) line height for a big number at `fontSize`. */
export function heroLineHeight(fontSize: number): number {
  return Math.round(fontSize * SF_LINE);
}

/** A hero number style at `size` pt (clamped to 28–150). `Text` adds the `heroTrim` margins. */
export function hero(size: number): TextStyle {
  const fontSize = Math.max(HERO_MIN, Math.min(HERO_MAX, size));
  return { ...type.hero, fontSize, lineHeight: heroLineHeight(fontSize) };
}

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;

export const radius = { tile: 8, segmented: 9, list: 14, card: 16, sheet: 34, capsule: 999 } as const;

/** Minimum hit target (pt). */
export const hit = 44;

/** Screen side margin used by every mockup frame. */
export const gutter = space.lg;

export const motion = {
  press: 120,
  standard: 250,
  standardMin: 200,
  standardMax: 300,
  ring: 600,
  easing: Easing.out(Easing.cubic),
  /** Pressed scale for buttons. No bounce anywhere. */
  pressScale: 0.98,
} as const;

// ---- Contrast helpers (WCAG 2.x), used by the token tests. -------------------------------

type RGBA = { r: number; g: number; b: number; a: number };

export function parseColor(value: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] == null ? 1 : +rgba[4] };
  }
  throw new Error(`Unsupported color: ${value}`);
}

/** Composite a (possibly translucent) foreground over an opaque background. */
export function composite(fg: string, bg: string): RGBA {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const mix = (x: number, y: number) => x * f.a + y * (1 - f.a);
  return { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b), a: 1 };
}

function luminance({ r, g, b }: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of `fg` drawn on the opaque `bg`. */
export function contrast(fg: string, bg: string): number {
  const l1 = luminance(composite(fg, bg));
  const l2 = luminance(parseColor(bg));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
