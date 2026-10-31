import { SignInPromptSettings } from './appSettings';

/**
 * Solo mode stays anonymous. After a few saved sets we offer (never require) Sign in with
 * Apple, so sets can sync and battles unlock. "Not now" snoozes the prompt.
 */
export interface SignInPromptState {
  /** Epoch ms of the last "Not now", or null. */
  dismissedAt: number | null;
}

export interface SignInPromptInput {
  settings: SignInPromptSettings;
  state: SignInPromptState;
  savedSets: number;
  signedIn: boolean;
  backendConfigured: boolean;
  appleAuthAvailable: boolean;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldShowSignInPrompt(i: SignInPromptInput): boolean {
  if (!i.settings.enabled || i.signedIn || !i.backendConfigured || !i.appleAuthAvailable) return false;
  if (i.savedSets < i.settings.afterSets) return false;
  if (i.state.dismissedAt !== null && i.now - i.state.dismissedAt < i.settings.snoozeDays * DAY_MS) return false;
  return true;
}

export const SIGN_IN_PROMPT_KEY = 'signInPrompt.v1';

export function sanitizeSignInPromptState(raw: unknown): SignInPromptState {
  if (typeof raw === 'object' && raw !== null) {
    const d = (raw as { dismissedAt?: unknown }).dismissedAt;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) return { dismissedAt: d };
  }
  return { dismissedAt: null };
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function loadSignInPromptState(kv: KeyValueStore): Promise<SignInPromptState> {
  try {
    const raw = await kv.getItem(SIGN_IN_PROMPT_KEY);
    return sanitizeSignInPromptState(raw ? JSON.parse(raw) : null);
  } catch {
    return { dismissedAt: null };
  }
}

export async function snoozeSignInPrompt(kv: KeyValueStore, now: number): Promise<SignInPromptState> {
  const state = { dismissedAt: now };
  await kv.setItem(SIGN_IN_PROMPT_KEY, JSON.stringify(state)).catch(() => {});
  return state;
}
