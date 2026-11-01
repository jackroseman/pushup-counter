import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useBackend } from '../backend/BackendProvider';
import { isAppleSignInAvailable, signInWithApple } from '../backend/auth';
import { loadSignInPromptState, shouldShowSignInPrompt, SignInPromptState, snoozeSignInPrompt } from '../backend/signInPrompt';
import { Button } from './ui';
import { colors } from '../theme';

/** Optional sign-in offer on the home screen. Solo use never requires an account. */
export function SignInCard({ savedSets }: { savedSets: number }) {
  const { configured, session, appSettings } = useBackend();
  const [state, setState] = useState<SignInPromptState | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSignInPromptState(AsyncStorage).then(setState);
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  if (!state) return null;
  const show = shouldShowSignInPrompt({
    settings: appSettings.signInPrompt,
    state,
    savedSets,
    signedIn: session !== null,
    backendConfigured: configured,
    appleAuthAvailable: appleAvailable,
    now: Date.now(),
  });
  if (!show) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Battle your friends</Text>
      <Text style={styles.text}>Sign in to back up your sets and challenge friends. Solo counting keeps working without an account.</Text>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={12}
        style={styles.apple}
        onPress={async () => {
          setMessage(null);
          const r = await signInWithApple();
          if (!r.ok && !r.cancelled) setMessage(r.message ?? 'Sign-in failed.');
        }}
      />
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <Button title="Not now" kind="secondary" onPress={() => snoozeSignInPrompt(AsyncStorage, Date.now()).then(setState)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 10 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  text: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  apple: { height: 48, width: '100%' },
  error: { color: colors.danger, fontSize: 13 },
});
