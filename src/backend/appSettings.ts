/**
 * Server-tunable product defaults. The source of truth is the `public.app_settings` table
 * (supabase/migrations/*_battles_initial.sql); these values mirror its seed and are used
 * offline, before the first fetch, or when the backend isn't configured.
 */
export interface FormScoreWeights {
  depth: number;
  consistency: number;
  tempo: number;
}

export type FriendsVisibility = 'battle_results_only';
export type SoloAccountMode = 'anonymous_optional_sign_in';

export interface SignInPromptSettings {
  enabled: boolean;
  /** Show the prompt once the user has saved at least this many solo sets. */
  afterSets: number;
  /** After "Not now", wait this many days before asking again. */
  snoozeDays: number;
}

export interface InviteLinkSettings {
  scheme: string;
  /** Universal-link base (e.g. https://example.vercel.app); null until the web page exists. */
  webBaseUrl: string | null;
}

export interface AppSettings {
  formScoreWeights: FormScoreWeights;
  asyncMaxParticipants: number;
  liveMaxParticipants: number;
  friendsVisibility: FriendsVisibility;
  soloAccountMode: SoloAccountMode;
  signInPrompt: SignInPromptSettings;
  inviteLinks: InviteLinkSettings;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  formScoreWeights: { depth: 0.5, consistency: 0.3, tempo: 0.2 },
  asyncMaxParticipants: 8,
  liveMaxParticipants: 2,
  friendsVisibility: 'battle_results_only',
  soloAccountMode: 'anonymous_optional_sign_in',
  signInPrompt: { enabled: true, afterSets: 3, snoozeDays: 14 },
  inviteLinks: { scheme: 'pushupcounter', webBaseUrl: null },
};

export interface AppSettingRow {
  key: string;
  value: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = num(v, min, max);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};

/** Weights must be non-negative and are normalised to sum to 1; anything invalid -> fallback. */
export function parseFormScoreWeights(v: unknown, fallback = DEFAULT_APP_SETTINGS.formScoreWeights): FormScoreWeights {
  if (!isObj(v)) return fallback;
  const d = num(v.depth, 0, 1);
  const c = num(v.consistency, 0, 1);
  const t = num(v.tempo, 0, 1);
  if (d === undefined || c === undefined || t === undefined) return fallback;
  const sum = d + c + t;
  if (sum <= 0) return fallback;
  return { depth: d / sum, consistency: c / sum, tempo: t / sum };
}

/** Builds AppSettings from `app_settings` rows. Unknown keys are ignored; bad values keep the default. */
export function parseAppSettings(rows: readonly AppSettingRow[] | null | undefined): AppSettings {
  const s: AppSettings = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
  for (const { key, value } of rows ?? []) {
    switch (key) {
      case 'form_score_weights':
        s.formScoreWeights = parseFormScoreWeights(value);
        break;
      case 'async_max_participants':
        s.asyncMaxParticipants = int(value, 2, 50) ?? s.asyncMaxParticipants;
        break;
      case 'live_max_participants':
        s.liveMaxParticipants = int(value, 2, 50) ?? s.liveMaxParticipants;
        break;
      case 'friends_visibility':
        if (value === 'battle_results_only') s.friendsVisibility = value;
        break;
      case 'solo_account_mode':
        if (value === 'anonymous_optional_sign_in') s.soloAccountMode = value;
        break;
      case 'sign_in_prompt':
        if (isObj(value)) {
          s.signInPrompt = {
            enabled: typeof value.enabled === 'boolean' ? value.enabled : s.signInPrompt.enabled,
            afterSets: int(value.after_sets, 0, 1000) ?? s.signInPrompt.afterSets,
            snoozeDays: int(value.snooze_days, 0, 365) ?? s.signInPrompt.snoozeDays,
          };
        }
        break;
      case 'invite_links':
        if (isObj(value)) {
          s.inviteLinks = {
            scheme: typeof value.scheme === 'string' && /^[a-z][a-z0-9+.-]*$/.test(value.scheme) ? value.scheme : s.inviteLinks.scheme,
            webBaseUrl:
              typeof value.web_base_url === 'string' && /^https:\/\/[^\s/]+/.test(value.web_base_url)
                ? value.web_base_url.replace(/\/+$/, '')
                : null,
          };
        }
        break;
    }
  }
  return s;
}

/** Minimal shape of the Supabase query we need (keeps this module free of native imports). */
export interface SettingsSource {
  from(table: 'app_settings'): {
    select(columns: string): PromiseLike<{ data: AppSettingRow[] | null; error: unknown }>;
  };
}

/** Fetch settings; never throws. Falls back to defaults when offline / unconfigured. */
export async function fetchAppSettings(source: SettingsSource | null): Promise<AppSettings> {
  if (!source) return parseAppSettings([]);
  try {
    const { data, error } = await source.from('app_settings').select('key,value');
    if (error) return parseAppSettings([]);
    return parseAppSettings(data);
  } catch {
    return parseAppSettings([]);
  }
}
