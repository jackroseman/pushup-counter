import { DEFAULT_LEAGUE_WEIGHTS, parseLeagueWeights, type LeagueWeights } from '../progress/league';

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

export type FriendsVisibility = 'battle_results_only' | 'league_and_challenge_results';
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

export interface AsyncBattleDefaults {
  deadlineHours: number;
  deadlineOptionsHours: number[];
  maxDeadlineHours: number;
  inviteExpiryHours: number;
  timedDurationsS: number[];
  attemptsAllowed: number;
  linkMaxUses: number;
  /** Max-reps battle sets end after this long without a rep... */
  maxRepsIdleEndS: number;
  /** ...or at this total length. */
  maxRepsCapS: number;
  /** A solo set can be used as the creator's attempt only if it ended within this many seconds. */
  claimSetMaxAgeS: number;
  /** Default multi-day window, and the windows the creator can pick (each 1–14 days). */
  multiDayWindowDays: number;
  multiDayWindowOptionsDays: number[];
}

export interface NotificationSettings {
  reminderHoursBefore: number;
  reminderAtHalfTime: boolean;
}

export interface StreakLengths {
  optionsDays: number[];
  minDays: number;
  maxDays: number;
}

export interface TeamTargets {
  options: number[];
  min: number;
  max: number;
  defaultTarget: number;
  defaultWindow: 'day' | 'week' | 'month';
}

export interface AppSettings {
  formScoreWeights: FormScoreWeights;
  asyncMaxParticipants: number;
  liveMaxParticipants: number;
  friendsVisibility: FriendsVisibility;
  /** Seconds after a recorded week ends during which a set can still join that week's league. */
  uploadGraceS: number;
  leagueWeights: LeagueWeights;
  soloAccountMode: SoloAccountMode;
  signInPrompt: SignInPromptSettings;
  inviteLinks: InviteLinkSettings;
  asyncBattleDefaults: AsyncBattleDefaults;
  notifications: NotificationSettings;
  /** Longest custom Most-reps or Team window, in days. */
  challengeCustomMaxDays: number;
  streakLengths: StreakLengths;
  teamTargets: TeamTargets;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  formScoreWeights: { depth: 0.5, consistency: 0.3, tempo: 0.2 },
  asyncMaxParticipants: 8,
  liveMaxParticipants: 2,
  friendsVisibility: 'league_and_challenge_results',
  uploadGraceS: 900,
  leagueWeights: DEFAULT_LEAGUE_WEIGHTS,
  soloAccountMode: 'anonymous_optional_sign_in',
  signInPrompt: { enabled: true, afterSets: 3, snoozeDays: 14 },
  inviteLinks: { scheme: 'pushupcounter', webBaseUrl: null },
  asyncBattleDefaults: {
    deadlineHours: 24,
    deadlineOptionsHours: [6, 24, 72],
    maxDeadlineHours: 168,
    inviteExpiryHours: 24,
    timedDurationsS: [60, 120],
    attemptsAllowed: 1,
    linkMaxUses: 7,
    maxRepsIdleEndS: 15,
    maxRepsCapS: 600,
    claimSetMaxAgeS: 1800,
    multiDayWindowDays: 7,
    multiDayWindowOptionsDays: [1, 7, 14],
  },
  notifications: { reminderHoursBefore: 2, reminderAtHalfTime: true },
  challengeCustomMaxDays: 92,
  streakLengths: { optionsDays: [7, 14, 30], minDays: 3, maxDays: 92 },
  teamTargets: { options: [200, 500, 1000], min: 10, max: 100000, defaultTarget: 500, defaultWindow: 'week' },
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

const intList = (v: unknown, min: number, max: number): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => int(x, min, max));
  if (!out.length || out.some((x) => x === undefined)) return undefined;
  return [...new Set(out as number[])].sort((a, b) => a - b);
};

export function parseAsyncBattleDefaults(v: unknown, fallback = DEFAULT_APP_SETTINGS.asyncBattleDefaults): AsyncBattleDefaults {
  if (!isObj(v)) return fallback;
  const maxDeadlineHours = int(v.max_deadline_hours, 1, 24 * 30) ?? fallback.maxDeadlineHours;
  const options = (intList(v.deadline_options_hours, 1, maxDeadlineHours) ?? fallback.deadlineOptionsHours).filter((h) => h <= maxDeadlineHours);
  const deadlineHours = int(v.deadline_hours, 1, maxDeadlineHours) ?? Math.min(fallback.deadlineHours, maxDeadlineHours);
  return {
    deadlineHours,
    deadlineOptionsHours: options.length ? options : [deadlineHours],
    maxDeadlineHours,
    inviteExpiryHours: int(v.invite_expiry_hours, 1, 24 * 30) ?? fallback.inviteExpiryHours,
    timedDurationsS: intList(v.timed_durations_s, 10, 3600) ?? fallback.timedDurationsS,
    attemptsAllowed: int(v.attempts_allowed, 1, 10) ?? fallback.attemptsAllowed,
    linkMaxUses: int(v.link_max_uses, 1, 50) ?? fallback.linkMaxUses,
    maxRepsIdleEndS: int(v.max_reps_idle_end_s, 5, 120) ?? fallback.maxRepsIdleEndS,
    maxRepsCapS: int(v.max_reps_cap_s, 30, 7200) ?? fallback.maxRepsCapS,
    claimSetMaxAgeS: int(v.claim_set_max_age_s, 60, 86400) ?? fallback.claimSetMaxAgeS,
    ...multiDayWindow(v, fallback),
  };
}

function multiDayWindow(v: Record<string, unknown>, fallback: AsyncBattleDefaults): Pick<AsyncBattleDefaults, 'multiDayWindowDays' | 'multiDayWindowOptionsDays'> {
  const parsed = intList(v.multi_day_window_options_days, 1, 14);
  const multiDayWindowOptionsDays = parsed?.length ? parsed : fallback.multiDayWindowOptionsDays;
  const requested = int(v.multi_day_window_days, 1, 14) ?? fallback.multiDayWindowDays;
  const multiDayWindowDays = multiDayWindowOptionsDays.includes(requested)
    ? requested
    : multiDayWindowOptionsDays.includes(fallback.multiDayWindowDays)
      ? fallback.multiDayWindowDays
      : multiDayWindowOptionsDays[0];
  return { multiDayWindowDays, multiDayWindowOptionsDays };
}

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

export function parseStreakLengths(v: unknown, fallback = DEFAULT_APP_SETTINGS.streakLengths): StreakLengths {
  if (!isObj(v)) return fallback;
  const minDays = int(v.min_days, 1, 366) ?? fallback.minDays;
  const maxDays = int(v.max_days, minDays, 366) ?? fallback.maxDays;
  const optionsDays = (intList(v.options_days, minDays, maxDays) ?? fallback.optionsDays).filter((d) => d >= minDays && d <= maxDays);
  return { optionsDays: optionsDays.length ? optionsDays : [minDays], minDays, maxDays };
}

export function parseTeamTargets(v: unknown, fallback = DEFAULT_APP_SETTINGS.teamTargets): TeamTargets {
  if (!isObj(v)) return fallback;
  const min = int(v.min, 1, 1_000_000) ?? fallback.min;
  const max = int(v.max, min, 1_000_000) ?? fallback.max;
  const options = (intList(v.options, min, max) ?? fallback.options).filter((n) => n >= min && n <= max);
  const defaultTarget = int(v.default, min, max) ?? fallback.defaultTarget;
  const defaultWindow = v.default_window === 'day' || v.default_window === 'week' || v.default_window === 'month' ? v.default_window : fallback.defaultWindow;
  return {
    options: options.length ? options : [Math.min(Math.max(defaultTarget, min), max)],
    min,
    max,
    defaultTarget: Math.min(Math.max(defaultTarget, min), max),
    defaultWindow,
  };
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
        // The old literal stays valid so a database that has not run this migration still parses.
        // Anything else, including a future value, keeps the bundled default.
        if (value === 'battle_results_only' || value === 'league_and_challenge_results') s.friendsVisibility = value;
        break;
      case 'upload_grace_s':
        s.uploadGraceS = int(value, 0, 86400) ?? s.uploadGraceS;
        break;
      case 'league_improvement_weights':
        s.leagueWeights = parseLeagueWeights(value);
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
      case 'async_battle_defaults':
        s.asyncBattleDefaults = parseAsyncBattleDefaults(value);
        break;
      case 'notifications':
        if (isObj(value)) {
          s.notifications = {
            reminderHoursBefore: num(value.reminder_hours_before, 0, 168) ?? s.notifications.reminderHoursBefore,
            reminderAtHalfTime:
              typeof value.reminder_at_half_time === 'boolean' ? value.reminder_at_half_time : s.notifications.reminderAtHalfTime,
          };
        }
        break;
      case 'challenge_custom_max_days':
        s.challengeCustomMaxDays = int(value, 1, 366) ?? s.challengeCustomMaxDays;
        break;
      case 'streak_lengths':
        s.streakLengths = parseStreakLengths(value);
        break;
      case 'team_targets':
        s.teamTargets = parseTeamTargets(value);
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
