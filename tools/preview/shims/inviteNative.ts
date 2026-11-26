/**
 * PREVIEW BUILD ONLY. Stands in for src/invites/native.ts: there are no expo-clipboard or
 * expo-haptics native modules in the browser, so Copy link "copies" into
 * window.__previewClipboard (flows can read it) and the haptic does nothing.
 */
declare const window: { __previewClipboard?: string };

export const canCopy = () => true;

export async function copyText(text: string): Promise<boolean> {
  window.__previewClipboard = text;
  return true;
}

export function lightHaptic(): void {}
