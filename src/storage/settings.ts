import { KeyValueStore } from './history';

export interface Settings {
  speakQuality: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speakQuality: true,
  haptics: true,
};

const SETTINGS_KEY = 'pushupcounter.settings.v1';

/**
 * Only known boolean keys are kept, so settings saved by older versions (e.g. the removed
 * `depthOnlyCounting` toggle; reps are now always counted from depth) load cleanly.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
    }
  }
  return out;
}

export async function loadSettings(kv: KeyValueStore): Promise<Settings> {
  try {
    const raw = await kv.getItem(SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(kv: KeyValueStore, s: Settings): Promise<void> {
  await kv.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s)));
}
