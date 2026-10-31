import { parseAppLink } from '../src/backend/linking';
import { readBackendConfig } from '../src/backend/config';

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(32);

describe('deep links', () => {
  it('parses scheme links', () => {
    expect(parseAppLink(`pushupcounter://battle/${ID}`)).toEqual({ type: 'battle', battleId: ID });
    expect(parseAppLink(`pushupcounter://invite/${TOKEN}?src=push`)).toEqual({ type: 'invite', token: TOKEN });
    expect(parseAppLink('pushupcounter://history')).toEqual({ type: 'history' });
    expect(parseAppLink('pushupcounter://')).toEqual({ type: 'home' });
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
