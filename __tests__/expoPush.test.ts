import {
  buildMessages,
  chunk,
  isExpoPushToken,
  parseNotifyRequest,
  parseSecretKeys,
  safeEqual,
  tokensToDisable,
} from '../supabase/functions/_shared/expoPush';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('notify Edge Function helpers', () => {
  it('recognizes Expo push tokens', () => {
    expect(isExpoPushToken('ExponentPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('abc')).toBe(false);
    expect(isExpoPushToken(3)).toBe(false);
  });

  it('builds one message per distinct valid token, in batches of 100', () => {
    const m = buildMessages(['ExponentPushToken[a]', 'ExponentPushToken[a]', 'bad', 'ExponentPushToken[b]'], { title: 't', body: 'b' });
    expect(m.map((x) => x.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
    expect(m[0]).toMatchObject({ title: 't', body: 'b', sound: 'default' });
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('disables only tokens Expo reports as unregistered', () => {
    const m = buildMessages(['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]'], { title: 't', body: 'b' });
    const dead = tokensToDisable(m, [
      { status: 'ok', id: '1' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
    ]);
    expect(dead).toEqual(['ExponentPushToken[b]']);
  });

  it('reads secret keys and compares safely', () => {
    expect(parseSecretKeys('{"default":"sb_secret_x","other":"y"}')).toEqual(['sb_secret_x', 'y']);
    expect(parseSecretKeys('nope', 'legacy')).toEqual(['legacy']);
    expect(parseSecretKeys(undefined)).toEqual([]);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });

  it('lets users send only test pushes', () => {
    expect(parseNotifyRequest({ test: true }, false)).toEqual({ kind: 'test' });
    expect(parseNotifyRequest({ userIds: [U1], title: 'x', body: 'y' }, false)).toMatchObject({ status: 403 });
  });

  it('validates server requests', () => {
    expect(parseNotifyRequest({ userIds: [U1, U1], title: ' Hi ', body: 'There', data: { battleId: 'b' } }, true)).toEqual({
      kind: 'server',
      userIds: [U1],
      content: { title: 'Hi', body: 'There', data: { battleId: 'b' } },
    });
    expect(parseNotifyRequest({ userIds: ['x'], title: 'a', body: 'b' }, true)).toMatchObject({ status: 400 });
    expect(parseNotifyRequest({ userIds: [], title: 'a', body: 'b' }, true)).toMatchObject({ status: 400 });
    expect(parseNotifyRequest({ userIds: [U1], title: '', body: 'b' }, true)).toMatchObject({ status: 400 });
    expect(parseNotifyRequest(null, true)).toMatchObject({ status: 400 });
  });
});
