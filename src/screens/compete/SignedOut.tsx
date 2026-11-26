import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

import { isAppleSignInAvailable, signInWithApple } from '../../backend/auth';
import { Avatar, Text, color, radius } from '../../ui';

/** Decorative faces above the sign-in pitch (frame 16). Hidden from VoiceOver. */
const FACES = ['J', 'M', 'B', 'L'];

/** Compete before signing in (frame 16). Solo sets keep working without an account. */
export function CompeteSignedOut({ configured }: { configured: boolean }) {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    isAppleSignInAvailable().then(setAppleAvailable);
  }, [configured]);

  return (
    <View style={styles.wrap}>
      <View style={styles.faces} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {FACES.map((name, i) => (
          <View key={name} style={[styles.ring, i > 0 && styles.overlap]}>
            <Avatar name={name} size={60} />
          </View>
        ))}
      </View>
      <Text variant="title1" align="center" style={styles.title} accessibilityRole="header">
        Better with friends
      </Text>
      <Text variant="body" tone="secondary" align="center" style={styles.message}>
        A weekly league and head-to-head challenges with people you know.
      </Text>
      {configured && appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={28}
          style={styles.apple}
          onPress={async () => {
            setMessage(null);
            const result = await signInWithApple();
            if (!result.ok && !result.cancelled) setMessage(result.message ?? 'Sign-in failed.');
          }}
        />
      ) : (
        <Text variant="subhead" align="center" style={styles.unavailable}>
          Sign in with Apple isn't available here.
        </Text>
      )}
      {message ? (
        <Text variant="footnote" tone="destructive" align="center" style={styles.error}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 70, paddingHorizontal: 10, alignItems: 'stretch' },
  faces: { flexDirection: 'row', justifyContent: 'center' },
  ring: { borderWidth: 3, borderColor: color.bg, borderRadius: radius.capsule },
  overlap: { marginLeft: -14 },
  title: { marginTop: 26 },
  message: { marginTop: 10, lineHeight: 24 },
  apple: { height: 56, alignSelf: 'stretch', marginTop: 30 },
  unavailable: { marginTop: 30 },
  error: { marginTop: 12 },
});
