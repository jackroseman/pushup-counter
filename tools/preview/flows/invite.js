// Personal invite links (docs/rebrand/IMPLEMENTATION_PLAN.md, invite frames a*/b*): sharing your
// link, and every way a friend's link can open. Run one with e.g. `capture -- invite-open`.
const SUNNY_CODE = 'k7m2qx9p';
const MAYA = { id: '77777777-7777-4777-8777-777777777777', username: 'maya', display_name: 'Maya', time_zone: 'America/New_York' };
const sunny = (status) => ({ status, inviter: { username: 'sunny', displayName: 'Sunny', userId: '11111111-1111-4111-8111-111111111111' } });
// Maya, signed in, opening Sunny's link.
const asMaya = (rpc = {}) => ({ user: 'regular', tables: { profiles: [MAYA] }, path: `i/${SUNNY_CODE}`, rpc });

module.exports = {
  order: 9,
  variants: [
    {
      id: 'share',
      description: 'Your link: Friends > Invite with a link, the invite sheet, Copied, QR code',
      options: { user: 'regular', path: 'friends' },
      run: async ({ shot, tap, page }) => {
        await shot('friends');
        await tap('Invite with a link', { wait: 2000 });
        await shot('invite-sheet');
        await tap('Copy link', { wait: 400 });
        await shot('copied');
        const copied = await page.evaluate(() => window.__previewClipboard);
        if (copied !== `https://reproyale.vercel.app/i/${SUNNY_CODE}`) throw new Error(`Copied ${copied}`);
        await tap('Show QR code', { wait: 1800 });
        await shot('qr');
      },
    },
    {
      id: 'settings',
      description: 'Settings > Account > Invite link opens the same sheet',
      options: { user: 'regular', path: 'account' },
      run: async ({ shot, tap }) => {
        await shot('settings');
        await tap('Invite link', { wait: 2000 });
        await shot('invite-sheet');
      },
    },
    {
      id: 'new-friend',
      description: 'Inviter: a friend who used the link shows first on Friends with a New tag',
      options: {
        user: 'regular',
        path: 'friends',
        // Friends was last opened yesterday; Maya joined through the link ten minutes ago.
        storage: { 'friends.seenAt.v1': String(new Date('2026-11-24T16:30:00-05:00').getTime()) },
        rpc: {
          my_friends: (_args, F) => [
            { user_id: MAYA.id, username: 'maya', display_name: 'Maya', relation: 'friend', since: new Date(F.now - 600000).toISOString() },
            ...F.friends.filter((f) => f.username !== 'maya'),
          ],
        },
      },
      run: async ({ shot }) => {
        await shot('friends-new');
      },
    },
    {
      id: 'open',
      description: "Maya opens Sunny's link: Add friend, then You're friends",
      options: asMaya({ friend_invite_preview: sunny('ok') }),
      run: async ({ shot, tap }) => {
        await shot('add-friend');
        await tap('Add friend', { wait: 1500 });
        await shot('added');
      },
    },
    {
      id: 'already',
      description: 'Opening a link from someone who is already a friend',
      options: asMaya({ friend_invite_preview: sunny('friends') }),
      run: async ({ shot }) => {
        await shot('already-friends');
      },
    },
    {
      id: 'own',
      description: 'Opening your own link',
      options: { user: 'regular', path: `i/${SUNNY_CODE}` },
      run: async ({ shot }) => {
        await shot('own-link');
      },
    },
    {
      id: 'invalid',
      description: "A reset, mistyped or blocked link: This link doesn't work",
      options: asMaya({ friend_invite_preview: { status: 'invalid' } }),
      run: async ({ shot, tap }) => {
        await shot('invalid');
        await tap('Search by username', { wait: 2000 });
        await shot('search');
      },
    },
    {
      id: 'signed-out',
      description: 'Signed out: Sunny invited you, Sign in with Apple, then Pick a username with the invite pill',
      options: {
        user: 'new',
        path: `i/${SUNNY_CODE}`,
        storage: { 'pushupcounter.onboarded.v1': '1', 'pushupcounter.howto.v1': '1' },
        rpc: { friend_invite_preview: sunny('ok') },
      },
      run: async ({ shot, tap }) => {
        await shot('signed-out');
        await tap('Sign in with Apple', { label: true, wait: 2500 });
        await shot('pick-username');
      },
    },
    {
      id: 'first-run',
      description: 'First launch from a link: Welcome with who invited you',
      options: { user: 'new', path: `i/${SUNNY_CODE}`, rpc: { friend_invite_preview: sunny('ok') } },
      run: async ({ shot }) => {
        await shot('welcome');
      },
    },
  ],
};
