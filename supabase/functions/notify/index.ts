// notify: send Expo push notifications.
//   Anyone: { drain: true } -> send whatever is queued in the notification outbox (the DB
//     writes rows there; this only claims and delivers them, so it is safe to call
//     unauthenticated: the worst a caller can do is make queued pushes go out sooner).
//     Called by pg_cron (private.wake_notify), by submit-set, and by the app after actions.
//   Server (apikey = a Supabase secret key): { userIds: uuid[], title, body, data? }
//   Signed-in user (Authorization: Bearer <user JWT>): { test: true } -> own devices only.
// Deployed with --no-verify-jwt (the platform check only understands legacy JWT keys);
// the function authorizes every request itself. Deployed by .github/workflows/supabase-deploy.yml.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildMessages, parseNotifyRequest, parseSecretKeys, safeEqual, TEST_CONTENT } from '../_shared/expoPush.ts';
import type { ClaimedNotification } from '../_shared/notificationContent.ts';
import { deliverClaimed, PushIO, sendMessages } from '../_shared/pushSender.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const secretKeys = parseSecretKeys(Deno.env.get('SUPABASE_SECRET_KEYS'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const admin = createClient(SUPABASE_URL, secretKeys[0] ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

const io: PushIO = {
  async tokensFor(userIds) {
    const { data, error } = await admin
      .from('push_tokens')
      .select('expo_push_token, devices!inner(user_id)')
      .in('devices.user_id', userIds)
      .is('disabled_at', null);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      token: r.expo_push_token as string,
      userId: (Array.isArray(r.devices) ? r.devices[0]?.user_id : (r.devices as { user_id: string })?.user_id) as string,
    }));
  },
  async disable(tokens) {
    await admin.from('push_tokens').update({ disabled_at: new Date().toISOString() }).in('expo_push_token', tokens);
  },
  fetch: (url, init) => fetch(url, init),
  expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN') ?? undefined, // only if "enhanced push security" is on
};

let registered = false;
async function drain() {
  if (!registered) {
    // Tell the database where to find us, so the pg_cron safety net can wake this function.
    const { error } = await admin.rpc('register_notify_url', { p_url: `${SUPABASE_URL}/functions/v1/notify` });
    registered = !error;
  }
  const totals = { notifications: 0, devices: 0, sent: 0, failed: 0, disabled: 0 };
  for (let round = 0; round < 5; round++) {
    const { data, error } = await admin.rpc('claim_notifications', { p_limit: 200 });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ClaimedNotification[];
    if (!rows.length) break;
    const s = await deliverClaimed(rows, io);
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += s[k];
    if (rows.length < 200) break;
  }
  return totals;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!secretKeys.length) return json(500, { error: 'server key missing' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }

  if ((body as { drain?: unknown } | null)?.drain === true) {
    try {
      return json(200, await drain());
    } catch (e) {
      return json(500, { error: (e as Error).message });
    }
  }

  const apikey = req.headers.get('apikey') ?? '';
  const isServer = secretKeys.some((k) => safeEqual(apikey, k));
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

  let tokens: { token: string }[];
  try {
    tokens = await io.tokensFor(userIds);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
  return json(200, await sendMessages(buildMessages(tokens.map((t) => t.token), content), io));
});
