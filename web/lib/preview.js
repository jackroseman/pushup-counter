// Who an invite is from: the friend_invite_preview RPC with the public (anon) key.
// SUPABASE_URL / SUPABASE_ANON_KEY are Vercel env vars (Preview -> staging, Production -> prod).
// Without them, or if the call fails, the page still works and just leaves the name out.
async function fetchPreview(code, env = process.env, fetchImpl = fetch) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  if (!url || !key) return { status: 'unknown', inviter: null };
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/friend_invite_preview`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { status: 'unknown', inviter: null };
    const body = await res.json();
    const i = body && body.inviter;
    if (body && body.status === 'invalid') return { status: 'invalid', inviter: null };
    if (!i || typeof i.username !== 'string') return { status: 'unknown', inviter: null };
    return {
      status: 'ok',
      inviter: { username: i.username, displayName: typeof i.displayName === 'string' && i.displayName.trim() ? i.displayName.trim() : null },
    };
  } catch {
    return { status: 'unknown', inviter: null };
  }
}

module.exports = { fetchPreview };
