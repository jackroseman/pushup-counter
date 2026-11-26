import { qualityLabel, type RepQuality } from '../core';

/**
 * What is said after each rep. With Count out loud on (Settings): the number, plus the quality
 * when the rep wasn't full ("5, shallow"). Off: nothing.
 */
export function repCallout(rep: { index: number; quality: RepQuality }, countOutLoud: boolean): string | null {
  if (!countOutLoud) return null;
  return rep.quality === 'full' ? String(rep.index) : `${rep.index}, ${qualityLabel(rep.quality).toLowerCase()}`;
}
