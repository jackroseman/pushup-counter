// The mock Supabase backend. The preview build talks to https://rr-preview.supabase.co; the
// browser driver (lib/browser.js) answers every request to it from here, so nothing ever reaches
// a real server. It also decides what the app finds in local storage on first launch.
//
// A flow picks a starting point with `user` and can override any piece:
//   user: 'regular' (default) signed in, a month of history, mid-goal today
//         'empty'   signed in, no sets, no goal, no friends
//         'new'     signed out, nothing on the phone -> onboarding
//   rpc:     { my_league: {...} | (args) => {...} }   replace one RPC result
//   path:    'i/k7m2qx9p'                               open the app at a link (deep-link path)
//   tables:  { profiles: [...] }                        replace a REST table read
//   storage: { 'pushupcounter.goal.v1': '...' | null } set or clear a local storage key
/* global Buffer */
const { build, FIXED_NOW } = require('./fixtures');
const { AUTH_STORAGE_KEY } = require('../lib/paths');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function sessionFor(me) {
  const user = {
    id: me, aud: 'authenticated', role: 'authenticated', email: 'sunny@example.com',
    app_metadata: { provider: 'apple' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z',
  };
  // Unsigned token: the mock never checks it, supabase-js only decodes it.
  const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: me, aud: 'authenticated', role: 'authenticated', exp: 1900000000, iat: 1764000000, email: user.email }) + '.sig';
  return { user, session: { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 1900000000, refresh_token: 'preview', user } };
}

function createBackend(options = {}) {
  const user = options.user || 'regular';
  const empty = user !== 'regular';
  const signedIn = options.signedIn ?? user !== 'new';
  const F = build(options.now || FIXED_NOW);
  const { user: authUser, session } = sessionFor(F.ME);

  const rpcDefaults = {
    my_progress: () => (empty ? F.emptyProgress : F.progress),
    my_league: () => (empty ? { ...F.league, total: [], improvement: [] } : F.league),
    my_challenges: (args) => (args && args.p_battle ? F.challenges.filter((c) => c.id === args.p_battle) : empty ? [] : F.challenges),
    my_open_challenges: () => (empty ? [] : F.openChallenges),
    my_challenge_record: () => (empty ? { periodFrom: F.now, periodTo: F.now, wins: 0, ties: 0, losses: 0, forfeits: 0, cancelled: 0, expired: 0, declined: 0, friends: [], otherEvents: [] } : F.challengeRecord),
    my_friends: () => (empty ? [] : F.friends),
    search_users: () => F.friends.slice(0, 2),
    friend_challenge_record: () => F.friendRecord,
    my_recap_ranks: () => null,
    register_device: () => 'preview-device',
    username_available: () => true,
    // Personal invite links. The preview user is Sunny; flows that play the friend who opens
    // Sunny's link override friend_invite_preview / redeem_friend_invite and the profile.
    my_friend_invite: () => F.inviteCode,
    reset_friend_invite: () => F.inviteCodeAfterReset,
    friend_invite_preview: () => ({ status: signedIn ? 'own' : 'ok', inviter: F.inviter }),
    redeem_friend_invite: () => 'added',
  };
  const tables = {
    profiles: signedIn ? [F.profile] : [],
    ...options.tables,
  };

  function rpc(name, args) {
    const override = options.rpc && name in options.rpc ? options.rpc[name] : undefined;
    if (override !== undefined) return typeof override === 'function' ? override(args, F) : override;
    return rpcDefaults[name] ? rpcDefaults[name](args) : null;
  }

  /** { method, path, accept, body } -> { status, body }. */
  function handle({ path, accept = '', body = '' }) {
    const single = accept.includes('vnd.pgrst.object');
    let result = null;
    if (path.startsWith('/auth/v1/user')) result = authUser;
    else if (path.startsWith('/auth/v1/')) result = session;
    else if (path.startsWith('/rest/v1/rpc/')) {
      let args = {};
      try {
        args = JSON.parse(body || '{}');
      } catch {
        args = {};
      }
      result = rpc(path.split('/').pop(), args);
    } else if (path.startsWith('/rest/v1/')) {
      const rows = tables[path.slice('/rest/v1/'.length).split('?')[0]] || [];
      result = single ? rows[0] ?? null : rows;
    } else if (path.startsWith('/functions/v1/')) result = { ok: true };
    if (single && result === null) return { status: 406, body: { code: 'PGRST116', message: 'no rows' } };
    return { status: 200, body: result };
  }

  /** Local storage the app finds on its first launch. null = key absent. */
  const storage = {
    [AUTH_STORAGE_KEY]: signedIn ? JSON.stringify(session) : null,
    'pushupcounter.history.v1': empty ? null : JSON.stringify(F.history),
    'pushupcounter.goal.v1': empty ? null : JSON.stringify([F.enrollment]),
    // Returning users have seen the first-run screens; 'new' users have not.
    'pushupcounter.onboarded.v1': user === 'new' ? null : '1',
    'pushupcounter.howto.v1': user === 'new' ? null : '1',
    ...options.storage,
  };

  return { handle, storage, fixtures: F };
}

module.exports = { createBackend };
