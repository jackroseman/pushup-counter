import { color } from './ui/tokens';

/**
 * Temporary shim (rebrand PR 1): the old theme names now point at the Direction A palette in
 * `src/ui/tokens.ts`, so screens that have not been rebuilt yet go monochrome without layout
 * changes. New code imports `src/ui` instead. Deleted in the cleanup PR (plan PR 15).
 */
export const colors = {
  bg: color.bg,
  card: color.surface,
  text: color.label,
  muted: color.secondary,
  accent: color.label,
  danger: color.destructive,
  quality: color.quality,
};
