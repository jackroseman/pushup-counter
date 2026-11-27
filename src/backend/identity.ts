import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { getInstallationId } from './installation';
import { PayloadContext, SyncBackend } from './sync';

/** Supabase-bound calls for devices, push tokens and account deletion. */

export async function registerDevice(client: SupabaseClient): Promise<string> {
  const installationId = await getInstallationId(AsyncStorage);
  const { data, error } = await client.rpc('register_device', {
    p_installation_id: installationId,
    p_model: Device.modelId ?? Device.modelName ?? null,
    p_os_version: Device.osVersion ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export async function getPushPermission(): Promise<PushPermission> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? Constants.easConfig?.projectId;

const EXPO_PUSH_TOKEN = /^(Exponent|Expo)PushToken\[.+\]$/;

type PushResult = { ok: true } | { ok: false; permission: PushPermission; message?: string };
type SavedPush = { deviceId: string; token: string; native: string | null };

// One successful save per app launch, until the native token changes.
let savedPush: SavedPush | null = null;
let pushFlight: Promise<PushResult> | null = null;

/** Test hook. Production registration state lives for the JS runtime. */
export function resetPushRegistrationCache(): void {
  savedPush = null;
  pushFlight = null;
}

function nativeKey(token: Notifications.DevicePushToken | undefined): string | null {
  if (!token) return null;
  return typeof token.data === 'string' ? token.data : JSON.stringify(token.data);
}

/**
 * Save this phone's Expo push token for the signed-in account. With ask=false it only
 * registers when permission was already granted (never shows the system prompt).
 *
 * Pass the device token from addPushTokenListener. Fetching it again inside that
 * listener calls getDevicePushTokenAsync, which emits the listener, which fetched
 * again. That loop is what hammered register_push_token.
 */
export async function registerPushToken(
  client: SupabaseClient,
  deviceId: string,
  ask: boolean,
  devicePushToken?: Notifications.DevicePushToken,
): Promise<PushResult> {
  const native = nativeKey(devicePushToken);
  if (!ask && savedPush?.deviceId === deviceId && (native === null || native === savedPush.native)) {
    return { ok: true };
  }
  // The listener fires while the first fetch is still in progress. Share that
  // attempt instead of starting another getExpoPushTokenAsync.
  if (!ask && pushFlight) return pushFlight;

  const run = savePushToken(client, deviceId, ask, devicePushToken, native);
  if (ask) return run;
  const wrapped = run.finally(() => {
    if (pushFlight === wrapped) pushFlight = null;
  });
  pushFlight = wrapped;
  return wrapped;
}

async function savePushToken(
  client: SupabaseClient,
  deviceId: string,
  ask: boolean,
  devicePushToken: Notifications.DevicePushToken | undefined,
  native: string | null,
): Promise<PushResult> {
  let permission = await getPushPermission();
  if (permission !== 'granted' && ask && permission === 'undetermined') {
    const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    permission = p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  }
  if (permission !== 'granted') return { ok: false, permission };
  if (!Device.isDevice) return { ok: false, permission, message: 'Push notifications need a real iPhone.' };
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: projectId(),
      ...(devicePushToken ? { devicePushToken } : {}),
    });
    if (!EXPO_PUSH_TOKEN.test(token)) {
      return { ok: false, permission, message: 'Push token was not an Expo token.' };
    }
    if (!ask && savedPush?.deviceId === deviceId && savedPush.token === token) {
      savedPush = { deviceId, token, native: native ?? savedPush.native };
      return { ok: true };
    }
    const { error } = await client.rpc('register_push_token', { p_device_id: deviceId, p_token: token });
    if (error) {
      // A failed save is not "done for this launch". The next call tries again.
      savedPush = null;
      return { ok: false, permission, message: error.message };
    }
    savedPush = { deviceId, token, native: native ?? savedPush?.native ?? null };
    return { ok: true };
  } catch (e) {
    savedPush = null;
    return { ok: false, permission, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Stop pushes to this phone for the current account (on sign-out). */
export async function unregisterPushToken(client: SupabaseClient, deviceId: string): Promise<void> {
  await client.from('push_tokens').delete().eq('device_id', deviceId);
}

export async function sendTestPush(client: SupabaseClient): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await client.functions.invoke('notify', { body: { test: true } });
  if (error) return { ok: false, message: error.message };
  const d = data as { devices?: number; sent?: number };
  if (!d?.devices) return { ok: false, message: 'No phone is registered for notifications yet.' };
  return { ok: (d.sent ?? 0) > 0, message: d.sent ? 'Sent. It should arrive in a few seconds.' : 'Expo did not accept the notification.' };
}

export async function deleteAccount(client: SupabaseClient): Promise<{ ok: boolean; message?: string }> {
  const { error } = await client.rpc('delete_my_account');
  if (error) return { ok: false, message: error.message };
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  return { ok: true };
}

export function supabaseSyncBackend(client: SupabaseClient): SyncBackend {
  return {
    submitSet: async (payload) => {
      const { error } = await client.rpc('submit_set', { p: payload });
      if (!error) client.functions.invoke('notify', { body: { drain: true } }).catch(() => {});
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    deleteSet: async (_userId, clientSetId) => {
      // Writes a tombstone and deletes the solo set (no-op for a challenge set or a missing row).
      const { error } = await client.rpc('delete_set', { p_client_set_id: clientSetId });
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    listUploadedIds: async (userId) => {
      const ids: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client
          .from('sets')
          .select('client_set_id')
          .eq('user_id', userId)
          .is('challenge_id', null)
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        ids.push(...(data ?? []).map((r) => r.client_set_id as string));
        if (!data || data.length < 1000) return ids;
      }
    },
    listDeletedIds: async (userId) => {
      const ids: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client
          .from('deleted_sets')
          .select('client_set_id')
          .eq('user_id', userId)
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        ids.push(...(data ?? []).map((r) => r.client_set_id as string));
        if (!data || data.length < 1000) return ids;
      }
    },
  };
}

/** Whether the user's backed-up set with this SessionRecord id is in a challenge. */
export async function setInChallenge(client: SupabaseClient, userId: string, clientSetId: string): Promise<boolean> {
  const { data, error } = await client
    .from('sets')
    .select('challenge_id')
    .eq('user_id', userId)
    .eq('client_set_id', clientSetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data?.challenge_id;
}

export function payloadContext(deviceId: string | null): PayloadContext {
  return {
    deviceId,
    appVersion: Constants.expoConfig?.version ?? null,
    updateId: Updates.updateId ?? null,
  };
}
