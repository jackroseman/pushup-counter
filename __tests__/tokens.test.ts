import { colors } from '../src/theme';
import { initialOf } from '../src/ui/Avatar';
import { splitSegments } from '../src/ui/FormSplitBar';
import { clamp01 } from '../src/ui/ProgressBar';
import { ringGeometry } from '../src/ui/Ring';
import { color, composite, contrast, hero, parseColor, radius, space, type } from '../src/ui/tokens';

describe('tokens: contrast', () => {
  const surfaces = { bg: color.bg, surface: color.surface } as const;
  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    it(`label on ${surfaceName} is at least 4.5:1`, () => {
      expect(contrast(color.label, surface)).toBeGreaterThanOrEqual(4.5);
    });
    it(`secondary on ${surfaceName} is at least 4.5:1`, () => {
      expect(contrast(color.secondary, surface)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('signal and destructive read on both backgrounds (≥ 4.5:1)', () => {
    for (const bg of [color.bg, color.surface]) {
      expect(contrast(color.signal, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color.destructive, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary button text (black on white) is maximal', () => {
    expect(contrast(color.bg, color.label)).toBeCloseTo(21, 0);
  });

  it('composites translucent colors over the background', () => {
    expect(composite(color.secondary, color.bg)).toEqual({ r: 141, g: 141, b: 147, a: 1 });
    expect(parseColor('#30D158')).toEqual({ r: 48, g: 209, b: 88, a: 1 });
    expect(() => parseColor('blue')).toThrow();
  });
});

describe('tokens: values match the plan (§1)', () => {
  it('palette', () => {
    expect(color).toMatchObject({
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
    });
    expect(color.quality).toEqual({ full: color.signal, good: color.label, shallow: color.graphite });
  });

  it('type ramp', () => {
    const sizeWeight = Object.fromEntries(
      (['largeTitle', 'title1', 'title2', 'headline', 'body', 'subhead', 'footnote', 'caption'] as const).map((k) => [
        k,
        `${type[k].fontSize}/${type[k].fontWeight}`,
      ]),
    );
    expect(sizeWeight).toEqual({
      largeTitle: '34/700',
      title1: '28/700',
      title2: '22/700',
      headline: '17/600',
      body: '17/400',
      subhead: '15/400',
      footnote: '13/400',
      caption: '12/500',
    });
    expect(type.counter).toEqual({ fontSize: 180, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -4 });
  });

  it('hero numbers are clamped to 28–150 and tabular', () => {
    expect(hero(84)).toMatchObject({ fontSize: 84, lineHeight: 77, fontWeight: '700', fontVariant: ['tabular-nums'] });
    expect(hero(10).fontSize).toBe(28);
    expect(hero(400).fontSize).toBe(150);
  });

  it('space and radius', () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 20, 24, 32]);
    expect(radius).toEqual({ tile: 8, segmented: 9, list: 14, card: 16, sheet: 34, capsule: 999 });
  });
});

describe('theme shim (old names → new palette)', () => {
  it('maps the old names', () => {
    expect(colors).toEqual({
      bg: color.bg,
      card: color.surface,
      text: color.label,
      muted: color.secondary,
      accent: color.label,
      danger: color.destructive,
      quality: { full: color.signal, good: color.label, shallow: color.graphite },
    });
  });
});

describe('ui helpers', () => {
  it('clamp01', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.44)).toBe(0.44);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
  });

  it('ringGeometry fills the arc by progress', () => {
    const g = ringGeometry(224, 10, 0.5);
    expect(g.r).toBe(106);
    expect(g.filled).toBeCloseTo(g.circumference / 2);
    expect(ringGeometry(224, 10, 2).filled).toBeCloseTo(g.circumference);
  });

  it('splitSegments drops empty segments and keeps the order', () => {
    expect(splitSegments({ full: 27, good: 0, shallow: 2 }).map((s) => s.key)).toEqual(['full', 'shallow']);
    expect(splitSegments({ full: 0, good: 0, shallow: 0 })).toEqual([]);
  });

  it('initialOf', () => {
    expect(initialOf('sunny')).toBe('S');
    expect(initialOf('@brett')).toBe('B');
    expect(initialOf('  ')).toBe('?');
  });
});
