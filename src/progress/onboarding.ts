import { HOWTO_KEY } from './howto';

/** Set once the first-run screens are done or skipped. */
export const ONBOARDED_KEY = 'pushupcounter.onboarded.v1';

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * First run shows Welcome → Pick a daily goal → How it works. Anyone who has used the app
 * before skips it: the old how-to was seen, there are sets on this phone, or they're signed in.
 */
export function needsOnboarding(input: { onboarded: boolean; howToSeen: boolean; setCount: number; signedIn: boolean }): boolean {
  return !input.onboarded && !input.howToSeen && input.setCount === 0 && !input.signedIn;
}

export async function loadOnboarded(kv: KeyValue): Promise<{ onboarded: boolean; howToSeen: boolean }> {
  try {
    const [onboarded, howTo] = await Promise.all([kv.getItem(ONBOARDED_KEY), kv.getItem(HOWTO_KEY)]);
    return { onboarded: onboarded === '1', howToSeen: howTo === '1' };
  } catch {
    // Unreadable storage: don't trap anyone in onboarding.
    return { onboarded: true, howToSeen: true };
  }
}

export async function markOnboarded(kv: KeyValue): Promise<void> {
  await kv.setItem(ONBOARDED_KEY, '1');
}
