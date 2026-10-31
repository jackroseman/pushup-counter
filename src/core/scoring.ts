import { DetectorConfig, RepQuality } from './types';

/**
 * Fraction (0..1) of the available travel that was used:
 *   (top - bottom) / (top - floorDistance)
 * 1.0 means the face got as close to the phone as physically possible.
 */
export function depthRatio(top: number, bottom: number, floorDistance: number): number {
  const available = top - floorDistance;
  if (!(available > 0)) return 0;
  const r = (top - bottom) / available;
  return Math.max(0, Math.min(1, r));
}

export function qualityForRatio(ratio: number, config: Pick<DetectorConfig, 'fullRatio' | 'goodRatio'>): RepQuality {
  if (ratio >= config.fullRatio) return 'full';
  if (ratio >= config.goodRatio) return 'good';
  return 'shallow';
}

export function qualityLabel(q: RepQuality): string {
  switch (q) {
    case 'full':
      return 'Full';
    case 'good':
      return 'Good';
    case 'shallow':
      return 'Shallow';
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
