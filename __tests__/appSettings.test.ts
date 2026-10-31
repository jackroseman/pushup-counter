import { DEFAULT_APP_SETTINGS, fetchAppSettings, parseAppSettings, parseFormScoreWeights, SettingsSource } from '../src/backend/appSettings';

const seed = [
  { key: 'form_score_weights', value: { depth: 0.5, consistency: 0.3, tempo: 0.2 } },
  { key: 'async_max_participants', value: 8 },
  { key: 'live_max_participants', value: 2 },
  { key: 'friends_visibility', value: 'battle_results_only' },
  { key: 'solo_account_mode', value: 'anonymous_optional_sign_in' },
  { key: 'sign_in_prompt', value: { enabled: true, after_sets: 3, snooze_days: 14 } },
  { key: 'invite_links', value: { scheme: 'pushupcounter', web_base_url: null } },
];

describe('app settings', () => {
  it('defaults match the database seed', () => {
    expect(parseAppSettings(seed)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings([])).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('reads tuned values from the server', () => {
    const s = parseAppSettings([
      { key: 'async_max_participants', value: 12 },
      { key: 'sign_in_prompt', value: { enabled: false, after_sets: 5, snooze_days: 7 } },
      { key: 'invite_links', value: { scheme: 'pushupcounter', web_base_url: 'https://pushup.example.app/' } },
    ]);
    expect(s.asyncMaxParticipants).toBe(12);
    expect(s.signInPrompt).toEqual({ enabled: false, afterSets: 5, snoozeDays: 7 });
    expect(s.inviteLinks.webBaseUrl).toBe('https://pushup.example.app');
  });

  it('keeps defaults for invalid values and ignores unknown keys', () => {
    const s = parseAppSettings([
      { key: 'async_max_participants', value: 1 },
      { key: 'live_max_participants', value: 2.5 },
      { key: 'friends_visibility', value: 'everything' },
      { key: 'invite_links', value: { scheme: 'Bad Scheme', web_base_url: 'http://insecure' } },
      { key: 'something_new', value: 42 },
    ]);
    expect(s.asyncMaxParticipants).toBe(8);
    expect(s.liveMaxParticipants).toBe(2);
    expect(s.friendsVisibility).toBe('battle_results_only');
    expect(s.inviteLinks).toEqual({ scheme: 'pushupcounter', webBaseUrl: null });
  });

  it('normalises form weights and rejects bad ones', () => {
    expect(parseFormScoreWeights({ depth: 1, consistency: 0.6, tempo: 0.4 })).toEqual({ depth: 0.5, consistency: 0.3, tempo: 0.2 });
    expect(parseFormScoreWeights({ depth: -1, consistency: 1, tempo: 1 })).toEqual(DEFAULT_APP_SETTINGS.formScoreWeights);
    expect(parseFormScoreWeights({ depth: 0, consistency: 0, tempo: 0 })).toEqual(DEFAULT_APP_SETTINGS.formScoreWeights);
    expect(parseFormScoreWeights('nope')).toEqual(DEFAULT_APP_SETTINGS.formScoreWeights);
  });

  it('fetch falls back to defaults without a backend, on error, or when offline', async () => {
    expect(await fetchAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    const failing: SettingsSource = { from: () => ({ select: async () => ({ data: null, error: new Error('x') }) }) };
    expect(await fetchAppSettings(failing)).toEqual(DEFAULT_APP_SETTINGS);
    const throwing: SettingsSource = { from: () => ({ select: () => Promise.reject(new Error('offline')) }) };
    expect(await fetchAppSettings(throwing)).toEqual(DEFAULT_APP_SETTINGS);
    const ok: SettingsSource = { from: () => ({ select: async () => ({ data: [{ key: 'async_max_participants', value: 6 }], error: null }) }) };
    expect((await fetchAppSettings(ok)).asyncMaxParticipants).toBe(6);
  });
});
