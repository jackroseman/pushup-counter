import { RepQuality } from './core';

export const colors = {
  bg: '#0B0F1A',
  card: '#151B2B',
  text: '#F4F6FB',
  muted: '#8A93A8',
  accent: '#FFB020',
  danger: '#FF5A5F',
  quality: {
    full: '#2BD67B',
    good: '#FFB020',
    shallow: '#FF5A5F',
  } satisfies Record<RepQuality, string>,
};
