/**
 * Deep links. pushupcounter://challenge/<id> and the older pushupcounter://battle/<id>
 * both open the challenge. pushupcounter://invite/<token> joins from a link.
 */
export const APP_SCHEME = 'pushupcounter';

export type AppLink =
  | { type: 'challenge'; challengeId: string }
  | { type: 'invite'; token: string }
  | { type: 'history' }
  | { type: 'progress' }
  | { type: 'challenges' }
  | { type: 'friends' }
  | { type: 'league' }
  | { type: 'home' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{32}$/i;

/** Parses an incoming URL into an app destination; returns null for anything unrecognised. */
export function parseAppLink(url: string, webBaseUrl: string | null = null): AppLink | null {
  let path: string;
  const schemePrefix = `${APP_SCHEME}://`;
  if (url.toLowerCase().startsWith(schemePrefix)) {
    path = url.slice(schemePrefix.length);
  } else if (webBaseUrl && url.startsWith(webBaseUrl + '/')) {
    path = url.slice(webBaseUrl.length + 1);
    const m = /^b\/([^/?#]+)/.exec(path);
    return m && TOKEN.test(m[1]) ? { type: 'invite', token: m[1].toLowerCase() } : null;
  } else {
    return null;
  }
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean);
  if (parts.length === 0) return { type: 'home' };
  const [head, arg] = parts;
  if (head === 'today' && parts.length === 1) return { type: 'home' };
  if ((head === 'challenge' || head === 'battle') && arg && UUID.test(arg)) return { type: 'challenge', challengeId: arg.toLowerCase() };
  if (head === 'invite' && arg && TOKEN.test(arg)) return { type: 'invite', token: arg.toLowerCase() };
  if (head === 'history' && parts.length === 1) return { type: 'history' };
  if (head === 'progress' && parts.length === 1) return { type: 'progress' };
  if ((head === 'challenges' || head === 'battles') && parts.length === 1) return { type: 'challenges' };
  if (head === 'friends' && parts.length === 1) return { type: 'friends' };
  if (head === 'league' && parts.length === 1) return { type: 'league' };
  return null;
}

/** The deep link carried by one of our pushes (data.url), if it is one the app understands. */
export function notificationLink(data: unknown, webBaseUrl: string | null = null): string | null {
  const url = typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined;
  return typeof url === 'string' && parseAppLink(url, webBaseUrl) ? url : null;
}
