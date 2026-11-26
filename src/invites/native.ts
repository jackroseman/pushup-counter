/**
 * Clipboard and a light haptic for the invite sheet, through expo-clipboard and expo-haptics
 * when the installed build has them. Builds made before they were added (the current dev
 * client) don't, so this looks the native modules up instead of importing the packages, and
 * Copy falls back to the share sheet, which has its own Copy.
 */
import { Share } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type ClipboardModule = { setStringAsync: (text: string, options: { inputFormat?: string }) => Promise<boolean> };
type HapticsModule = { impactAsync: (style: string) => Promise<void> };

const clipboard = () => requireOptionalNativeModule<ClipboardModule>('ExpoClipboard');
const haptics = () => requireOptionalNativeModule<HapticsModule>('ExpoHaptics');

export const canCopy = () => !!clipboard();

/** Copies the text. Returns false when it fell back to the share sheet (or failed). */
export async function copyText(text: string): Promise<boolean> {
  const c = clipboard();
  if (c) {
    try {
      await c.setStringAsync(text, { inputFormat: 'plainText' });
      return true;
    } catch {
      // fall through to the share sheet
    }
  }
  try {
    await Share.share({ message: text });
  } catch {
    // nothing useful to show
  }
  return false;
}

export function lightHaptic(): void {
  haptics()
    ?.impactAsync('light')
    .catch(() => {});
}
