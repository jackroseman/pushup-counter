import { KeyValueStore } from './history';

export interface Settings {
  depthOnlyCounting: boolean;
  speakQuality: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  depthOnlyCounting: false,
  speakQuality: true,
  haptics: true,
};

const SETTINGS_KEY = 'pushupcounter.settings.v1';

export async function loadSettings(kv: KeyValueStore): Promise<Settings> {
  try {
    const raw = await kv.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(kv: KeyValueStore, s: Settings): Promise<void> {
  await kv.setItem(SETTINGS_KEY, JSON.stringify(s));
}
