// notify: send Expo push notifications.
//   Server (apikey = a Supabase secret key): { userIds: uuid[], title, body, data? }
//   Signed-in user (Authorization: Bearer <user JWT>): { test: true } -> own devices only.
// Deployed with --no-verify-jwt (the platform check only understands legacy JWT keys);
// the function authorizes every request itself. Deployed by .github/workflows/supabase-deploy.yml.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildMessages,
  chunk,
  EXPO_PUSH_URL,
  ExpoTicket,
  parseNotifyRequest,
  parseSecretKeys,
  safeEqual,
  TEST_CONTENT,
  tokensToDisable,
} from '../_shared/expoPush.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const secretKeys = parseSecretKeys(Deno.env.get('SUPABASE_SECRET_KEYS'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKeys[0] ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!secretKeys.length) return json(500, { error: 'server key missing' });

  const apikey = req.headers.get('apikey') ?? '';
  const isServer = secretKeys.some((k) => safeEqual(apikey, k));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const parsed = parseNotifyRequest(body, isServer);
  if ('error' in parsed) return json(parsed.status, { error: parsed.error });

  let userIds: string[];
  let content = TEST_CONTENT;
  if (parsed.kind === 'test') {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
    if (error || !data?.user) return json(401, { error: 'sign in required' });
    userIds = [data.user.id];
  } else {
    userIds = parsed.userIds;
    content = parsed.content;
  }

  const { data: rows, error } = await admin
    .from('push_tokens')
    .select('expo_push_token, devices!inner(user_id)')
    .in('devices.user_id', userIds)
    .is('disabled_at', null);
  if (error) return json(500, { error: error.message });

  const messages = buildMessages((rows ?? []).map((r) => r.expo_push_token as string), content);
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // only if "enhanced push security" is enabled in Expo
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  for (const batch of chunk(messages)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(expoToken ? { Authorization: `Bearer ${expoToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      failed += batch.length;
      continue;
    }
    const tickets = ((await res.json()).data ?? []) as ExpoTicket[];
    sent += tickets.filter((t) => t.status === 'ok').length;
    failed += tickets.filter((t) => t.status === 'error').length;
    dead.push(...tokensToDisable(batch, tickets));
  }
  if (dead.length) {
    await admin.from('push_tokens').update({ disabled_at: new Date().toISOString() }).in('expo_push_token', dead);
  }
  return json(200, { devices: messages.length, sent, failed, disabled: dead.length });
});
