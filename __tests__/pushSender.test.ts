import { deliverClaimed, messagesFor, PushIO, sendMessages } from '../supabase/functions/_shared/pushSender';
import type { ClaimedNotification } from '../supabase/functions/_shared/notificationContent';

const T1 = 'ExponentPushToken[one]';
const T2 = 'ExponentPushToken[two]';
const friendReq = (user: string): ClaimedNotification => ({ id: 1, user_id: user, kind: 'friend_request', battle_id: null, facts: { actor: { username: 'bob' } } });

function io(response: unknown = { data: [] }, ok = true) {
  const calls: { url: string; body: unknown[] }[] = [];
  const disabled: string[][] = [];
  const x: PushIO = {
    tokensFor: async (ids) => ids.flatMap((id) => (id === 'a' ? [{ userId: 'a', token: T1 }, { userId: 'a', token: T1 }, { userId: 'a', token: 'junk' }] : [{ userId: id, token: T2 }])),
    disable: async (t) => {
      disabled.push(t);
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok, json: async () => response };
    },
  };
  return { x, calls, disabled };
}

describe('pushSender', () => {
  it('fans out one message per notification per distinct valid device', () => {
    const msgs = messagesFor([friendReq('a'), friendReq('b'), friendReq('nobody')], [
      { userId: 'a', token: T1 },
      { userId: 'a', token: T1 },
      { userId: 'a', token: 'junk' },
      { userId: 'b', token: T2 },
    ]);
    expect(msgs.map((m) => m.to)).toEqual([T1, T2]);
    expect(msgs[0]).toMatchObject({ title: 'Friend request', sound: 'default', priority: 'high' });
  });

  it('skips notifications with no text', () => {
    expect(messagesFor([{ ...friendReq('a'), kind: 'nope' }], [{ userId: 'a', token: T1 }])).toEqual([]);
  });

  it('delivers, counts tickets and disables dead tokens', async () => {
    const { x, calls, disabled } = io({ data: [{ status: 'ok', id: '1' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }] });
    const s = await deliverClaimed([friendReq('a'), friendReq('b')], x);
    expect(calls).toHaveLength(1);
    expect(s).toEqual({ notifications: 2, devices: 2, sent: 1, failed: 1, disabled: 1 });
    expect(disabled).toEqual([[T2]]);
  });

  it('counts a failed Expo request as failed', async () => {
    const { x } = io({}, false);
    expect(await sendMessages(messagesFor([friendReq('a')], [{ userId: 'a', token: T1 }]), x)).toEqual({ devices: 1, sent: 0, failed: 1, disabled: 0 });
  });

  it('does nothing for an empty claim', async () => {
    const { x, calls } = io();
    expect((await deliverClaimed([], x)).notifications).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
