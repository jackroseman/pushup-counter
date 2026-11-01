import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useBackend } from './BackendProvider';
import { PENDING_DISPLAY_NAME_KEY } from './auth';
import { supabase } from './supabase';
import { fetchProfile, Profile } from './profile';
import {
  deleteAccount as deleteAccountApi,
  getPushPermission,
  payloadContext,
  PushPermission,
  registerDevice,
  registerPushToken,
  sendTestPush,
  supabaseSyncBackend,
  unregisterPushToken,
} from './identity';
import { loadSyncState, syncSets, syncStatus, SyncStatus } from './sync';
import { onHistoryChanged } from './syncEvents';
import { historyStore } from '../session/useSession';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const SYNC_MIN_INTERVAL_MS = 60_000;

export interface IdentityState {
  /** undefined = loading or unknown (offline); null = signed in but no username yet. */
  profile: Profile | null | undefined;
  profileError: string | null;
  setProfile: (p: Profile) => void;
  refreshProfile: () => void;
  deviceId: string | null;
  sync: { status: SyncStatus | null; running: boolean; error: string | null; syncNow: () => Promise<void> };
  push: {
    permission: PushPermission;
    registered: boolean;
    enable: () => Promise<{ ok: boolean; message?: string }>;
    sendTest: () => Promise<{ ok: boolean; message: string }>;
  };
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ ok: boolean; message?: string }>;
}

const noop = async () => {};
const IdentityContext = createContext<IdentityState>({
  profile: undefined,
  profileError: null,
  setProfile: () => {},
  refreshProfile: () => {},
  deviceId: null,
  sync: { status: null, running: false, error: null, syncNow: noop },
  push: { permission: 'undetermined', registered: false, enable: async () => ({ ok: false }), sendTest: async () => ({ ok: false, message: '' }) },
  signOut: noop,
  deleteAccount: async () => ({ ok: false }),
});

/** Signed-in account state: profile, this phone's device row + push token, and set backup. */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const { session } = useBackend();
  const userId = session?.user.id ?? null;
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNonce, setProfileNonce] = useState(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const [registered, setRegistered] = useState(false);
  const [syncState, setSyncState] = useState<{ status: SyncStatus | null; running: boolean; error: string | null }>({
    status: null,
    running: false,
    error: null,
  });
  const syncing = useRef<Promise<void> | null>(null);
  const lastSync = useRef(0);

  // Profile for the signed-in user.
  useEffect(() => {
    setProfile(undefined);
    setProfileError(null);
    setDeviceId(null);
    setRegistered(false);
    if (!supabase || !userId) return;
    let alive = true;
    fetchProfile(supabase, userId).then(
      (p) => alive && setProfile(p),
      (e: Error) => alive && setProfileError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [userId, profileNonce]);

  const hasProfile = !!profile && profile.id === userId;

  // Device row + silent push registration once the profile exists.
  useEffect(() => {
    if (!supabase || !userId || !hasProfile) return;
    let alive = true;
    const client = supabase;
    (async () => {
      const id = await registerDevice(client);
      if (!alive) return;
      setDeviceId(id);
      setPermission(await getPushPermission());
      const r = await registerPushToken(client, id, false);
      if (alive) setRegistered(r.ok);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, hasProfile]);

  // Expo can rotate the token; keep the server copy current.
  useEffect(() => {
    if (!supabase || !deviceId) return;
    const client = supabase;
    const sub = Notifications.addPushTokenListener(() => {
      registerPushToken(client, deviceId, false).then((r) => setRegistered(r.ok));
    });
    return () => sub.remove();
  }, [deviceId]);

  const runSync = useCallback(
    async (force: boolean) => {
      if (!supabase || !userId || !hasProfile || !deviceId) return;
      if (syncing.current) return syncing.current;
      if (!force && Date.now() - lastSync.current < SYNC_MIN_INTERVAL_MS) return;
      const client = supabase;
      const job = (async () => {
        setSyncState((s) => ({ ...s, running: true }));
        try {
          const history = await historyStore.load();
          const r = await syncSets({ backend: supabaseSyncBackend(client), kv: AsyncStorage, userId, history, ctx: payloadContext(deviceId) });
          lastSync.current = Date.now();
          setSyncState({ status: syncStatus(history, r.state), running: false, error: r.error });
        } catch (e) {
          setSyncState((s) => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
        }
      })();
      syncing.current = job;
      try {
        await job;
      } finally {
        syncing.current = null;
      }
    },
    [userId, hasProfile, deviceId],
  );

  // Backfill on sign-in, then after every saved set and when the app comes back.
  useEffect(() => {
    if (!hasProfile || !deviceId) return;
    runSync(true);
    const off = onHistoryChanged(() => runSync(true));
    const sub = AppState.addEventListener('change', (s) => s === 'active' && runSync(false));
    return () => {
      off();
      sub.remove();
    };
  }, [hasProfile, deviceId, runSync]);

  // Show the current status even before the first sync finishes.
  useEffect(() => {
    if (!userId || !hasProfile) return;
    Promise.all([historyStore.load(), loadSyncState(AsyncStorage)]).then(([h, s]) => {
      if (s.userId === userId) setSyncState((st) => (st.status ? st : { ...st, status: syncStatus(h, s) }));
    });
  }, [userId, hasProfile]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    if (deviceId) await unregisterPushToken(supabase, deviceId).catch(() => {});
    await supabase.auth.signOut().catch(() => supabase?.auth.signOut({ scope: 'local' }));
  }, [deviceId]);

  const value = useMemo<IdentityState>(
    () => ({
      profile: userId ? profile : undefined,
      profileError,
      setProfile: (p) => setProfile(p),
      refreshProfile: () => setProfileNonce((n) => n + 1),
      deviceId,
      sync: { ...syncState, syncNow: () => runSync(true) },
      push: {
        permission,
        registered,
        enable: async () => {
          if (!supabase || !deviceId) return { ok: false, message: 'Finish setting up your account first.' };
          const r = await registerPushToken(supabase, deviceId, true);
          setPermission(r.ok ? 'granted' : r.permission);
          setRegistered(r.ok);
          if (r.ok) return { ok: true };
          if (r.permission === 'denied') return { ok: false, message: 'Notifications are off for this app. Turn them on in iOS Settings.' };
          return { ok: false, message: 'message' in r ? r.message : undefined };
        },
        sendTest: () => (supabase ? sendTestPush(supabase) : Promise.resolve({ ok: false, message: 'Not available.' })),
      },
      signOut,
      deleteAccount: async () => {
        if (!supabase) return { ok: false, message: 'Not available.' };
        const r = await deleteAccountApi(supabase);
        if (r.ok) await AsyncStorage.removeItem(PENDING_DISPLAY_NAME_KEY).catch(() => {});
        return r;
      },
    }),
    [userId, profile, profileError, deviceId, syncState, runSync, permission, registered, signOut],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export const useIdentity = () => useContext(IdentityContext);
