import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Button } from '../components/ui';
import { colors } from '../theme';
import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import { isAppleSignInAvailable, signInWithApple } from '../backend/auth';

/** Account: profile, backup status, notifications, sign out, delete account. */
export function AccountScreen({ onEditProfile, onBack }: { onEditProfile: () => void; onBack: () => void }) {
  const { configured, session } = useBackend();
  const { profile, profileError, refreshProfile, sync, push, signOut, deleteAccount } = useIdentity();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  if (!configured) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.text}>Accounts are not available in this build.</Text>
        <Button title="Back" onPress={onBack} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.text}>Sign in to back up your sets and battle friends. Solo counting keeps working without an account.</Text>
        {appleAvailable ? (
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
        ) : (
          <Text style={styles.text}>Sign in with Apple is not available on this device.</Text>
        )}
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Button title="Back" kind="secondary" onPress={onBack} />
      </View>
    );
  }

  const confirmDelete = () =>
    Alert.alert(
      'Delete account?',
      'This permanently deletes your profile, friends, backed-up sets and battle entries. Sets saved on this phone stay here. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const r = await deleteAccount();
            setBusy(false);
            if (r.ok) onBack();
            else setMessage(r.message ?? 'Could not delete the account. Try again.');
          },
        },
      ],
    );

  const s = sync.status;
  const backupLine = !s
    ? 'Not backed up yet.'
    : s.eligible === 0
      ? 'No sets to back up yet.'
      : `${s.backedUp} of ${s.eligible} sets backed up${s.rejected ? ` (${s.rejected} could not be uploaded)` : ''}.`;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Account</Text>

      <View style={styles.card}>
        {profile === undefined ? (
          profileError ? (
            <>
              <Text style={styles.error}>Could not load your profile.</Text>
              <Button title="Retry" kind="secondary" style={inCard} onPress={refreshProfile} />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )
        ) : profile === null ? (
          <>
            <Text style={styles.text}>Pick a username so friends can find you.</Text>
            <Button title="Choose username" onPress={onEditProfile} />
          </>
        ) : (
          <>
            <Text style={styles.name}>{profile.displayName || profile.username}</Text>
            <Text style={styles.text}>@{profile.username}</Text>
            <Button title="Edit profile" kind="secondary" style={inCard} onPress={onEditProfile} />
          </>
        )}
      </View>

      {profile ? (
        <>
          <View style={styles.card}>
            <Text style={styles.section}>Backup</Text>
            <Text style={styles.text}>{backupLine}</Text>
            {sync.error ? <Text style={styles.error}>Last backup failed: {sync.error}</Text> : null}
            {sync.running ? <ActivityIndicator color={colors.accent} /> : <Button title="Back up now" kind="secondary" style={inCard} onPress={sync.syncNow} />}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Notifications</Text>
            {push.registered ? (
              <>
                <Text style={styles.text}>On. You will hear about challenges and battle results.</Text>
                <Button
                  title="Send test notification"
                  kind="secondary"
                  style={inCard}
                  onPress={async () => setMessage((await push.sendTest()).message)}
                />
              </>
            ) : (
              <>
                <Text style={styles.text}>
                  {push.permission === 'denied'
                    ? 'Notifications are off for this app. Turn them on in iOS Settings.'
                    : 'Get notified when a friend challenges you or a battle ends.'}
                </Text>
                {push.permission !== 'denied' ? (
                  <Button
                    title="Turn on notifications"
                    kind="secondary"
                    style={inCard}
                    onPress={async () => {
                      const r = await push.enable();
                      setMessage(r.ok ? 'Notifications are on.' : r.message ?? null);
                    }}
                  />
                ) : null}
              </>
            )}
          </View>
        </>
      ) : null}

      {message ? <Text style={styles.text}>{message}</Text> : null}
      {busy ? <ActivityIndicator color={colors.accent} /> : null}

      <Button title="Sign out" kind="secondary" onPress={() => signOut().then(onBack)} />
      <Button title="Delete account" kind="danger" onPress={confirmDelete} />
      <Button title="Back" onPress={onBack} />
    </ScrollView>
  );
}

const inCard = { backgroundColor: colors.bg };

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 12, marginBottom: 12 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 8, marginBottom: 12 },
  section: { color: colors.text, fontSize: 17, fontWeight: '700' },
  name: { color: colors.text, fontSize: 20, fontWeight: '700' },
  text: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13 },
  apple: { height: 48, width: '100%', marginVertical: 12 },
});
