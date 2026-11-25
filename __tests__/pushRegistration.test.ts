import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('expo-notifications', () => {
  const listeners: Array<(token: { type: string; data: string }) => void> = [];
  return {
    getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: false })),
    requestPermissionsAsync: jest.fn(),
    addPushTokenListener: jest.fn((listener: (token: { type: string; data: string }) => void) => {
      listeners.push(listener);
      return {
        remove: () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      };
    }),
    getExpoPushTokenAsync: jest.fn(async (opts?: { devicePushToken?: { data: string } }) => {
      if (!opts?.devicePushToken) {
        for (const listener of [...listeners]) listener({ type: 'ios', data: 'apns-device-token' });
      }
      return { type: 'expo', data: 'ExponentPushToken[abc]' };
    }),
    __listeners: listeners,
  };
});

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'pid' } } }, easConfig: null }));
jest.mock('expo-updates', () => ({ updateId: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import * as Notifications from 'expo-notifications';
import { registerPushToken, resetPushRegistrationCache } from '../src/backend/identity';

const notifications = Notifications as typeof Notifications & {
  getExpoPushTokenAsync: jest.Mock;
  __listeners: Array<(token: { type: string; data: string }) => void>;
};

function clientWithRpc(rpc: jest.Mock) {
  return { rpc } as unknown as SupabaseClient;
}

describe('push token registration', () => {
  beforeEach(() => {
    resetPushRegistrationCache();
    notifications.getExpoPushTokenAsync.mockClear();
    notifications.__listeners.length = 0;
  });

  it('registers once per launch and does not loop when the token listener fires', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const client = clientWithRpc(rpc);
    const sub = Notifications.addPushTokenListener((deviceToken) => {
      void registerPushToken(client, 'device-1', false, deviceToken);
    });

    const first = await registerPushToken(client, 'device-1', false);
    const second = await registerPushToken(client, 'device-1', false);
    sub.remove();

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('register_push_token', {
      p_device_id: 'device-1',
      p_token: 'ExponentPushToken[abc]',
    });
    expect(notifications.getExpoPushTokenAsync.mock.calls.length).toBeLessThan(4);
  });

  it('retries a save that failed instead of treating that launch as registered', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
      .mockResolvedValueOnce({ data: null, error: null });
    const client = clientWithRpc(rpc);
    const first = await registerPushToken(client, 'device-1', false);
    const second = await registerPushToken(client, 'device-1', false);
    expect(first).toEqual({ ok: false, permission: 'granted', message: 'timeout' });
    expect(second).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('registers again when the native token changes', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const client = clientWithRpc(rpc);
    await registerPushToken(client, 'device-1', false, { type: 'ios', data: 'apns-1' });
    notifications.getExpoPushTokenAsync.mockResolvedValueOnce({ type: 'expo', data: 'ExponentPushToken[next]' });
    await registerPushToken(client, 'device-1', false, { type: 'ios', data: 'apns-2' });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('register_push_token', {
      p_device_id: 'device-1',
      p_token: 'ExponentPushToken[next]',
    });
  });
});
