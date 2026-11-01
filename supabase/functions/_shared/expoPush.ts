// Pure helpers for the notify Edge Function (no Deno or npm imports, so jest tests them;
// see __tests__/expoPush.test.ts).

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH = 100;
export const MAX_USERS_PER_CALL = 500;

const TOKEN_RE = /^(Exponent|Expo)PushToken\[.+\]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isExpoPushToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);

export interface PushContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoMessage extends PushContent {
  to: string;
  sound: 'default';
  priority: 'high';
}

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

/** One message per distinct valid token. */
export function buildMessages(tokens: readonly string[], content: PushContent): ExpoMessage[] {
  return [...new Set(tokens.filter(isExpoPushToken))].map((to) => ({ to, sound: 'default', priority: 'high', ...content }));
}

export function chunk<T>(items: readonly T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tokens Expo says are dead (app uninstalled / notifications revoked): disable them. */
export function tokensToDisable(messages: readonly ExpoMessage[], tickets: readonly ExpoTicket[]): string[] {
  const out: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' && messages[i]) out.push(messages[i].to);
  });
  return out;
}

/** Values of SUPABASE_SECRET_KEYS (a JSON object of name -> key), plus the legacy service role key. */
export function parseSecretKeys(secretKeysJson: string | undefined, legacyServiceRole?: string): string[] {
  const keys: string[] = [];
  if (secretKeysJson) {
    try {
      const o = JSON.parse(secretKeysJson);
      if (o && typeof o === 'object') for (const v of Object.values(o)) if (typeof v === 'string' && v) keys.push(v);
    } catch {
      // ignore malformed env
    }
  }
  if (legacyServiceRole) keys.push(legacyServiceRole);
  return keys;
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type NotifyRequest =
  | { kind: 'server'; userIds: string[]; content: PushContent }
  | { kind: 'test' };

/**
 * Server callers (secret key) may notify any users. Signed-in users may only send a test
 * notification to their own devices.
 */
export function parseNotifyRequest(body: unknown, isServer: boolean): NotifyRequest | { error: string; status: number } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isServer) return b.test === true ? { kind: 'test' } : { error: 'only test notifications are allowed', status: 403 };
  const ids = b.userIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_USERS_PER_CALL || !ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
    return { error: `userIds must be 1..${MAX_USERS_PER_CALL} uuids`, status: 400 };
  }
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!title || title.length > 100 || !text || text.length > 300) return { error: 'title (1..100) and body (1..300) are required', status: 400 };
  const data = typeof b.data === 'object' && b.data !== null && !Array.isArray(b.data) ? (b.data as Record<string, unknown>) : undefined;
  return { kind: 'server', userIds: [...new Set(ids as string[])], content: { title, body: text, ...(data ? { data } : {}) } };
}

export const TEST_CONTENT: PushContent = {
  title: 'Rep Royale',
  body: 'Notifications are working. You will hear from us when a friend challenges you.',
  data: { type: 'test' },
};
