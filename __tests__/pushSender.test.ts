import { deliverClaimed, drainOutbox, messagesFor, OutboxOps, planDelivery, PushIO, sendMessages } from '../supabase/functions/_shared/pushSender';
import type { ClaimedNotification } from '../supabase/functions/_shared/notificationContent';

const T1 = 'ExponentPushToken[one]';
const T2 = 'ExponentPushToken[two]';
const friendReq = (user: string, id = 1): ClaimedNotification => ({ id, user_id: user, kind: 'friend_request', challenge_id: null, facts: { actor: { username: 'bob' } } });

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
    const s = await deliverClaimed([friendReq('a', 1), friendReq('b', 2)], x);
    expect(calls).toHaveLength(1);
    expect(s).toEqual({ notifications: 2, devices: 2, sent: 1, failed: 1, disabled: 1, attemptedIds: [1, 2] });
    expect(disabled).toEqual([[T2]]);
  });

  it('counts a failed Expo request as failed', async () => {
    const { x } = io({}, false);
    expect(await sendMessages(messagesFor([friendReq('a')], [{ userId: 'a', token: T1 }]), x)).toEqual({ devices: 1, sent: 0, failed: 1, disabled: 0 });
  });

  it('does nothing for an empty claim', async () => {
    const { x, calls } = io();
    expect(await deliverClaimed([], x)).toEqual({ notifications: 0, devices: 0, sent: 0, failed: 0, disabled: 0, attemptedIds: [] });
    expect(calls).toHaveLength(0);
  });

  it('does not count a push that never reached Expo', async () => {
    const { x } = io({}, false);
    const s = await deliverClaimed([friendReq('a', 4)], x);
    expect(s.attemptedIds).toEqual([]);
    expect(s.failed).toBe(1);
  });

  it('leaves a row with text but no device unattempted', async () => {
    const x: PushIO = {
      tokensFor: async () => [],
      disable: async () => {},
      fetch: async () => {
        throw new Error('should not send');
      },
    };
    expect((await deliverClaimed([friendReq('a', 5)], x)).attemptedIds).toEqual([]);
  });
});

function ops() {
  const settled: { sent: number[]; failed: number[] }[] = [];
  const released: number[][] = [];
  let queued: ClaimedNotification[] = [];
  const x: OutboxOps = {
    lease: async () => {
      const rows = queued;
      queued = [];
      return rows;
    },
    settle: async (sent, failed) => {
      settled.push({ sent, failed });
    },
    release: async (ids) => {
      released.push(ids);
    },
  };
  return { x, settled, released, queue: (rows: ClaimedNotification[]) => { queued = rows; } };
}

describe('drainOutbox', () => {
  it('marks a known empty nudge failed and keeps an unknown kind queued', async () => {
    const box = ops();
    box.queue([
      { id: 8, user_id: 'a', kind: 'daily_nudge', challenge_id: null, facts: { nudge: { target: 30, reps: 4, rest: false } } },
      { id: 9, user_id: 'a', kind: 'future_kind', challenge_id: null, facts: {} },
    ]);
    const { x } = io();
    await drainOutbox(box.x, x);
    expect(box.settled).toEqual([{ sent: [], failed: [8] }]);
    expect(box.released).toEqual([[9]]);
  });

  it('marks sent only after Expo accepts the body', async () => {
    const box = ops();
    box.queue([friendReq('a', 3)]);
    const { x } = io({ data: [{ status: 'ok', id: 't' }] });
    await drainOutbox(box.x, x);
    expect(box.settled).toEqual([{ sent: [3], failed: [] }]);
    expect(box.released).toEqual([[]]);
  });

  it('releases a row when the push request fails', async () => {
    const box = ops();
    box.queue([friendReq('a', 6)]);
    const { x } = io({}, false);
    await drainOutbox(box.x, x);
    expect(box.settled).toEqual([{ sent: [], failed: [] }]);
    expect(box.released).toEqual([[6]]);
  });

  it('releases every ready row when token lookup throws', async () => {
    const box = ops();
    box.queue([friendReq('a', 7)]);
    const x: PushIO = {
      tokensFor: async () => {
        throw new Error('db down');
      },
      disable: async () => {},
      fetch: async () => {
        throw new Error('no');
      },
    };
    await drainOutbox(box.x, x);
    expect(box.settled).toEqual([{ sent: [], failed: [] }]);
    expect(box.released).toEqual([[7]]);
  });

  it('plans a ready row, a failed known kind, and an unknown kind', () => {
    const plan = planDelivery([
      friendReq('a', 1),
      { id: 2, user_id: 'a', kind: 'daily_nudge', challenge_id: null, facts: { nudge: { target: 30, reps: 1, rest: false } } },
      { id: 3, user_id: 'a', kind: 'not_a_kind', challenge_id: null, facts: {} },
    ]);
    expect(plan.ready.map((row) => row.id)).toEqual([1]);
    expect(plan.failed).toEqual([2]);
    expect(plan.retry).toEqual([3]);
  });
});
