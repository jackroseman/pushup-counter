// submit-set: the only way a battle set gets into the database (SPEC §7 hard checks).
//   POST { ...set payload (same shape as the solo submit_set RPC), battleId }
//   Authorization: Bearer <user JWT>
// Verifies the user, checks the data's shape (_shared/setValidation.ts), then calls
// submit_set() as the service role with the verified user id. The DB triggers enforce the
// battle rules (accepted participant, open battle, attempts left, deadline + 5 min).
// Afterwards it runs finalize_battles() (so a battle completes the moment the last person
// plays) and wakes notify to send the pushes. Idempotent: a retry returns the same set id.
// Deployed with --no-verify-jwt like notify; the function checks the JWT itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseSecretKeys } from '../_shared/expoPush.ts';
import { statusForDbError, validateBattleSet } from '../_shared/setValidation.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const secretKeys = parseSecretKeys(Deno.env.get('SUPABASE_SECRET_KEYS'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const admin = createClient(SUPABASE_URL, secretKeys[0] ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!secretKeys.length) return json(500, { error: 'server key missing' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  if (authError || !auth?.user) return json(401, { error: 'sign in required' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const v = validateBattleSet(body);
  if (!v.ok) return json(400, { error: v.error });

  const { data: setId, error } = await admin.rpc('submit_set', { p: { ...v.payload, userId: auth.user.id } });
  if (error) return json(statusForDbError(error.message, error.code), { error: error.message });

  // Best effort: complete/lock the battle if this was the last attempt, then send pushes.
  await admin.rpc('finalize_battles').then(() => undefined, () => undefined);
  const drain = fetch(`${SUPABASE_URL}/functions/v1/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drain: true }),
  }).then(() => undefined, () => undefined);
  // Keep the instance alive for the drain without making the user wait for it.
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(drain);

  return json(200, { setId });
});
