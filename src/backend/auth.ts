import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from './supabase';

export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export type SignInResult = { ok: true } | { ok: false; cancelled: boolean; message?: string };

/** Sign in with Apple -> Supabase session (signInWithIdToken). */
export async function signInWithApple(): Promise<SignInResult> {
  if (!supabase) return { ok: false, cancelled: false, message: 'Sign-in is not available in this build.' };
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
    });
    if (!credential.identityToken) return { ok: false, cancelled: false, message: 'Apple did not return a token.' };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
    if (error) return { ok: false, cancelled: false, message: error.message };
    return { ok: true };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === 'ERR_REQUEST_CANCELED') return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, message: e instanceof Error ? e.message : 'Sign-in failed.' };
  }
}
