import { notificationLink, parseAppLink } from '../src/backend/linking';
import { readBackendConfig } from '../src/backend/config';
import { getStateFromPath, linkingConfig } from '../src/navigation/linkingConfig';

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(32);

describe('deep links', () => {
  it('parses scheme links', () => {
    expect(parseAppLink(`pushupcounter://battle/${ID}`)).toEqual({ type: 'challenge', challengeId: ID });
    expect(parseAppLink(`pushupcounter://challenge/${ID}`)).toEqual({ type: 'challenge', challengeId: ID });
    expect(parseAppLink(`pushupcounter://invite/${TOKEN}?src=push`)).toEqual({ type: 'invite', token: TOKEN });
    expect(parseAppLink('pushupcounter://history')).toEqual({ type: 'history' });
    expect(parseAppLink('pushupcounter://progress')).toEqual({ type: 'progress' });
    expect(parseAppLink('pushupcounter://league')).toEqual({ type: 'league' });
    expect(parseAppLink('pushupcounter://')).toEqual({ type: 'home' });
    expect(parseAppLink('pushupcounter://today')).toEqual({ type: 'home' });
  });

  it('rejects malformed or foreign links', () => {
    expect(parseAppLink('pushupcounter://battle/not-a-uuid')).toBeNull();
    expect(parseAppLink('pushupcounter://invite/short')).toBeNull();
    expect(parseAppLink('pushupcounter://unknown')).toBeNull();
    expect(parseAppLink(`https://evil.example/b/${TOKEN}`)).toBeNull();
  });

  it('parses universal invite links only for the configured domain', () => {
    expect(parseAppLink(`https://pushup.example.app/b/${TOKEN}`, 'https://pushup.example.app')).toEqual({ type: 'invite', token: TOKEN });
    expect(parseAppLink(`https://pushup.example.app/b/${TOKEN}`, null)).toBeNull();
  });
});

describe('challenge links and push taps', () => {
  it('parses the challenges and friends screens', () => {
    expect(parseAppLink('pushupcounter://battles')).toEqual({ type: 'challenges' });
    expect(parseAppLink('pushupcounter://challenges')).toEqual({ type: 'challenges' });
    expect(parseAppLink('pushupcounter://friends')).toEqual({ type: 'friends' });
    expect(parseAppLink('pushupcounter://friends/extra')).toBeNull();
    expect(parseAppLink('pushupcounter://league/extra')).toBeNull();
  });

  it('takes the url from a push only when the app understands it', () => {
    expect(notificationLink({ url: `pushupcounter://battle/${ID}`, type: 'battle_result' })).toBe(`pushupcounter://battle/${ID}`);
    expect(notificationLink({ url: 'pushupcounter://friends' })).toBe('pushupcounter://friends');
    expect(notificationLink({ url: 'https://evil.example/x' })).toBeNull();
    expect(notificationLink({ url: 42 })).toBeNull();
    expect(notificationLink(null)).toBeNull();
    expect(notificationLink('pushupcounter://friends')).toBeNull();
  });
});

describe('backend config', () => {
  it('requires both public values and a supabase.co URL', () => {
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: 'k',
    });
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(readBackendConfig({})).toBeNull();
  });
});

/** Focused route chain of a linking state, e.g. `Main > Compete {"segment":"league"}`. */
function landing(path: string): string | undefined {
  const state = getStateFromPath(path, linkingConfig);
  if (!state) return undefined;
  const parts: string[] = [];
  let current: typeof state | undefined = state;
  while (current) {
    const route: (typeof current.routes)[number] = current.routes[current.index ?? current.routes.length - 1];
    const params = route.params && Object.keys(route.params).length ? ` ${JSON.stringify(route.params)}` : '';
    parts.push(`${route.name}${route.state ? '' : params}`);
    current = route.state as typeof state | undefined;
  }
  return parts.join(' > ');
}

/** What Back lands on: the screen under the linked one (`Main` with its tab, if any). */
function under(path: string) {
  const routes = getStateFromPath(path, linkingConfig)?.routes ?? [];
  return routes.length > 1 ? routes[0] : null;
}

describe('navigation shell links (every old path)', () => {
  it.each([
    ['', 'Main > Today'],
    ['today', 'Main > Today'],
    ['league', 'Main > Compete {"segment":"league"}'],
    ['challenges', 'Main > Compete {"segment":"challenges"}'],
    ['battles', 'Main > Compete {"segment":"challenges"}'],
    ['league?src=push', 'Main > Compete {"segment":"league"}'],
    ['/challenges/', 'Main > Compete {"segment":"challenges"}'],
    ['progress', 'Main > You'],
    ['history', 'AllSets'],
    ['account', 'Settings'],
    ['friends', 'Friends'],
    [`challenge/${ID}`, `Battle {"challengeId":"${ID}"}`],
    [`battle/${ID}`, `Battle {"challengeId":"${ID}"}`],
    [`invite/${TOKEN}`, `Invite {"token":"${TOKEN}"}`],
  ])('%j lands on %s', (path, expected) => {
    expect(landing(path)).toBe(expected);
  });

  it('keeps Main under pushed screens so the header Back works on a cold start', () => {
    expect(under(`battle/${ID}`)).toEqual({ name: 'Main', params: { screen: 'Compete', params: { segment: 'challenges' } } });
    expect(under('friends')).toEqual({ name: 'Main', params: { screen: 'Compete', params: { segment: 'challenges' } } });
    expect(under(`invite/${TOKEN}`)).toEqual({ name: 'Main' });
    expect(under('history')).toEqual({ name: 'Main' });
    expect(under('account')).toEqual({ name: 'Main' });
    expect(under('league')).toBeNull();
  });

  it('push urls from the server resolve to a screen', () => {
    for (const url of [`pushupcounter://challenge/${ID}`, 'pushupcounter://friends', 'pushupcounter://league', 'pushupcounter://today']) {
      expect(landing(url.replace('pushupcounter://', ''))).toBeDefined();
    }
  });
});
