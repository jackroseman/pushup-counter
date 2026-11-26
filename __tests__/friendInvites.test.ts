import { parsePreview } from '../src/invites/api';
import { inviteLinkLabel, inviteUrl, normalizeInviteCode, INVITE_WEB_HOST } from '../src/invites/links';
import { newFirst, newFriendIds, takeFriendsSeenAt, FRIENDS_SEEN_KEY } from '../src/invites/newFriends';
import { pendingInvite } from '../src/invites/pending';
import type { Friend } from '../src/battles/model';

describe('invite links', () => {
  it('builds the shared link from the one web host', () => {
    expect(INVITE_WEB_HOST).toBe('reproyale.vercel.app');
    expect(inviteUrl('k7m2qx9p')).toBe('https://reproyale.vercel.app/i/k7m2qx9p');
    expect(inviteLinkLabel('k7m2qx9p')).toBe('reproyale.vercel.app/i/k7m2qx9p');
  });

  it('normalizes codes', () => {
    expect(normalizeInviteCode(' K7M2QX9P ')).toBe('k7m2qx9p');
    expect(normalizeInviteCode('k7m2qx9')).toBeNull();
    expect(normalizeInviteCode('k7m2qx91')).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
  });
});

describe('invite preview', () => {
  it('reads who it is from', () => {
    expect(parsePreview({ status: 'ok', inviter: { username: 'sunny', displayName: 'Sunny', userId: 'u1' } })).toEqual({
      status: 'ok',
      inviter: { username: 'sunny', displayName: 'Sunny', userId: 'u1' },
    });
    expect(parsePreview({ status: 'friends', inviter: { username: 'sunny', displayName: ' ' } })).toEqual({
      status: 'friends',
      inviter: { username: 'sunny', displayName: null },
    });
  });

  it('anything odd is invalid', () => {
    expect(parsePreview(null).status).toBe('invalid');
    expect(parsePreview({ status: 'ok' }).status).toBe('invalid');
    expect(parsePreview({ status: 'weird', inviter: { username: 'x' } }).status).toBe('invalid');
  });
});

describe('held invite', () => {
  it('keeps the code and fills in the inviter for the same code only', () => {
    const seen: (string | null)[] = [];
    const off = pendingInvite.subscribe(() => seen.push(pendingInvite.get()?.code ?? null));
    pendingInvite.set({ code: 'aaaaaaaa', inviter: null });
    pendingInvite.setInviter('bbbbbbbb', { username: 'x', displayName: null });
    expect(pendingInvite.get()?.inviter).toBeNull();
    pendingInvite.setInviter('aaaaaaaa', { username: 'sunny', displayName: 'Sunny' });
    expect(pendingInvite.get()?.inviter?.username).toBe('sunny');
    pendingInvite.clear('bbbbbbbb');
    expect(pendingInvite.get()).not.toBeNull();
    pendingInvite.clear('aaaaaaaa');
    expect(pendingInvite.get()).toBeNull();
    off();
    expect(seen).toEqual(['aaaaaaaa', 'aaaaaaaa', null]);
  });
});

describe('New tag on Friends', () => {
  const f = (userId: string, since: string | null, relation: Friend['relation'] = 'friend'): Friend => ({ userId, username: userId, displayName: null, relation, since });
  const rows = [f('jack', '2026-11-20T10:00:00Z'), f('maya', '2026-11-26T12:00:00Z'), f('req', '2026-11-26T12:00:00Z', 'incoming')];

  it('marks friends added since the list was last opened', () => {
    expect([...newFriendIds(rows, Date.parse('2026-11-25T00:00:00Z'))]).toEqual(['maya']);
    expect(newFriendIds(rows, null).size).toBe(0);
    expect(newFirst(rows, new Set(['maya'])).map((x) => x.userId)).toEqual(['maya', 'jack', 'req']);
  });

  it('opening the list moves the mark', async () => {
    const mem = new Map<string, string>();
    const store = { getItem: async (k: string) => mem.get(k) ?? null, setItem: async (k: string, v: string) => void mem.set(k, v) };
    expect(await takeFriendsSeenAt(store, 1000)).toBeNull();
    await Promise.resolve();
    expect(mem.get(FRIENDS_SEEN_KEY)).toBe('1000');
    expect(await takeFriendsSeenAt(store, 2000)).toBe(1000);
  });
});
