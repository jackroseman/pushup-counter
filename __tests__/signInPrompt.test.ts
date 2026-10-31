import { DEFAULT_APP_SETTINGS } from '../src/backend/appSettings';
import {
  loadSignInPromptState,
  sanitizeSignInPromptState,
  shouldShowSignInPrompt,
  SignInPromptInput,
  snoozeSignInPrompt,
} from '../src/backend/signInPrompt';

const DAY = 86_400_000;
const base: SignInPromptInput = {
  settings: DEFAULT_APP_SETTINGS.signInPrompt,
  state: { dismissedAt: null },
  savedSets: 3,
  signedIn: false,
  backendConfigured: true,
  appleAuthAvailable: true,
  now: 100 * DAY,
};

describe('sign-in prompt', () => {
  it('shows after enough solo sets for anonymous users', () => {
    expect(shouldShowSignInPrompt(base)).toBe(true);
    expect(shouldShowSignInPrompt({ ...base, savedSets: 2 })).toBe(false);
  });

  it('never shows when signed in, disabled, unconfigured, or Apple auth is unavailable', () => {
    expect(shouldShowSignInPrompt({ ...base, signedIn: true })).toBe(false);
    expect(shouldShowSignInPrompt({ ...base, settings: { ...base.settings, enabled: false } })).toBe(false);
    expect(shouldShowSignInPrompt({ ...base, backendConfigured: false })).toBe(false);
    expect(shouldShowSignInPrompt({ ...base, appleAuthAvailable: false })).toBe(false);
  });

  it('respects the snooze window', () => {
    expect(shouldShowSignInPrompt({ ...base, state: { dismissedAt: base.now - 13 * DAY } })).toBe(false);
    expect(shouldShowSignInPrompt({ ...base, state: { dismissedAt: base.now - 14 * DAY } })).toBe(true);
    expect(shouldShowSignInPrompt({ ...base, settings: { ...base.settings, snoozeDays: 0 }, state: { dismissedAt: base.now } })).toBe(true);
  });

  it('persists and sanitises snooze state', async () => {
    const mem = new Map<string, string>();
    const kv = { getItem: async (k: string) => mem.get(k) ?? null, setItem: async (k: string, v: string) => void mem.set(k, v) };
    expect(await loadSignInPromptState(kv)).toEqual({ dismissedAt: null });
    await snoozeSignInPrompt(kv, 1234);
    expect(await loadSignInPromptState(kv)).toEqual({ dismissedAt: 1234 });
    expect(sanitizeSignInPromptState({ dismissedAt: 'x' })).toEqual({ dismissedAt: null });
    mem.set('signInPrompt.v1', '{bad json');
    expect(await loadSignInPromptState(kv)).toEqual({ dismissedAt: null });
  });
});
