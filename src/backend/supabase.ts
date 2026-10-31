import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { backendConfig } from './config';

/** Session storage in the iOS Keychain. */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

/** null when this build has no backend config (e.g. local dev without EAS env vars). */
export const supabase: SupabaseClient | null = backendConfig
  ? createClient(backendConfig.url, backendConfig.anonKey, {
      auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    })
  : null;
