import { KeyValueStore } from './history';

export interface Settings {
  /** Say each rep's number during a set (Settings › Count out loud). */
  countOutLoud: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  countOutLoud: true,
};

const SETTINGS_KEY = 'pushupcounter.settings.v1';

/**
 * Only known boolean keys are kept, so settings saved by older versions (e.g. the removed
 * `depthOnlyCounting`, `haptics` and `speakQuality` toggles) load cleanly.
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
