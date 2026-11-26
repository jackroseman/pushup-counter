import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isAppleSignInAvailable } from '../../backend/auth';
import { Avatar, Button, Icon, Text, color, gutter, space } from '../../ui';

export type FriendInviteState =
  | { kind: 'loading' }
  | { kind: 'add'; name: string; username: string; busy?: boolean; error?: string | null }
  | { kind: 'added'; name: string }
  | { kind: 'already'; name: string }
  | { kind: 'own'; name: string }
  | { kind: 'invalid' }
  | { kind: 'signedOut'; name: string; error?: string | null }
  | { kind: 'needsUsername'; name: string }
  | { kind: 'error'; message: string };

export type FriendInviteActions = {
  onAdd: () => void;
  onChallenge: () => void;
  onShare: () => void;
  onSearch: () => void;
  onSignIn: () => void;
  onPickUsername: () => void;
  onRetry: () => void;
  /** Not now / Done. */
  onClose: () => void;
};

/** A friend's invite link opened in the app (invite frames b1–b6). */
export function FriendInviteSheet({ state, ...a }: { state: FriendInviteState } & FriendInviteActions) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingBottom: Math.max(bottom, space.md) + space.xs }]}>
      <Body state={state} {...a} />
    </View>
  );
}

function Head({ art, title, sub, subLarge }: { art: React.ReactNode; title: string; sub?: string; subLarge?: boolean }) {
  return (
    <>
      <View style={styles.art}>{art}</View>
      <Text variant="title2" align="center" style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {sub ? (
        <Text variant={subLarge ? 'body' : 'subhead'} tone="secondary" align="center" style={subLarge ? styles.subLarge : styles.sub}>
          {sub}
        </Text>
      ) : null}
    </>
  );
}

function Actions({ primary, secondary }: { primary: React.ReactNode; secondary: { title: string; onPress: () => void } }) {
  return (
    <View style={styles.actions}>
      {primary}
      <Button title={secondary.title} kind="plain" onPress={secondary.onPress} style={styles.plain} />
    </View>
  );
}

function Body({ state, ...a }: { state: FriendInviteState } & FriendInviteActions) {
  switch (state.kind) {
    case 'loading':
      return <ActivityIndicator color={color.secondary} style={styles.loading} />;
    case 'add':
      return (
        <>
          <Head art={<Avatar name={state.name} size={76} />} title={`Add ${state.name} as a friend?`} sub={`@${state.username}`} />
          {state.error ? <ErrorLine text={state.error} /> : null}
          <Actions
            primary={<Button title="Add friend" loading={state.busy} onPress={a.onAdd} style={styles.primary} />}
            secondary={{ title: 'Not now', onPress: a.onClose }}
          />
        </>
      );
    case 'added':
      return (
        <>
          <Head
            art={
              <View>
                <Avatar name={state.name} size={76} />
                <View style={styles.badge}>
                  <Icon name="check" size={15} color={color.bg} />
                </View>
              </View>
            }
            title={`You and ${state.name} are friends`}
            sub="You'll see each other in the league."
          />
          <Actions
            primary={<Button title={`Challenge ${state.name}`} onPress={a.onChallenge} style={styles.primary} />}
            secondary={{ title: 'Done', onPress: a.onClose }}
          />
        </>
      );
    case 'already':
      return (
        <>
          <Head art={<Avatar name={state.name} size={76} />} title={`You and ${state.name} are already friends`} />
          <Actions
            primary={<Button title={`Challenge ${state.name}`} onPress={a.onChallenge} style={styles.primary} />}
            secondary={{ title: 'Done', onPress: a.onClose }}
          />
        </>
      );
    case 'own':
      return (
        <>
          <Head art={<Avatar name={state.name} size={76} />} title="This is your invite link" sub="Send it to friends so they can add you." subLarge />
          <Actions
            primary={<Button title="Share link" icon="share" onPress={a.onShare} style={styles.primaryTight} />}
            secondary={{ title: 'Done', onPress: a.onClose }}
          />
        </>
      );
    case 'invalid':
      return (
        <>
          <Head
            art={
              <View style={styles.linkTile}>
                <Icon name="link" size={32} color={color.label} />
              </View>
            }
            title="This link doesn't work"
            sub={'Ask your friend for a new link,\nor find them by username.'}
            subLarge
          />
          <Actions
            primary={<Button title="Search by username" onPress={a.onSearch} style={styles.primaryTight} />}
            secondary={{ title: 'Done', onPress: a.onClose }}
          />
        </>
      );
    case 'signedOut':
      return (
        <>
          <Head art={<Avatar name={state.name} size={76} />} title={`${state.name} invited you`} sub={`Sign in to add ${state.name} as a friend.`} subLarge />
          {state.error ? <ErrorLine text={state.error} /> : null}
          <Actions primary={<AppleButton onPress={a.onSignIn} />} secondary={{ title: 'Not now', onPress: a.onClose }} />
        </>
      );
    case 'needsUsername':
      return (
        <>
          <Head art={<Avatar name={state.name} size={76} />} title={`${state.name} invited you`} sub={`Pick a username to add ${state.name} as a friend.`} subLarge />
          <Actions
            primary={<Button title="Pick a username" onPress={a.onPickUsername} style={styles.primaryTight} />}
            secondary={{ title: 'Not now', onPress: a.onClose }}
          />
        </>
      );
    case 'error':
      return (
        <>
          <Head
            art={
              <View style={styles.linkTile}>
                <Icon name="link" size={32} color={color.label} />
              </View>
            }
            title="Couldn't open this link"
            sub={state.message}
            subLarge
          />
          <Actions
            primary={<Button title="Try again" onPress={a.onRetry} style={styles.primaryTight} />}
            secondary={{ title: 'Done', onPress: a.onClose }}
          />
        </>
      );
  }
}

function ErrorLine({ text }: { text: string }) {
  return (
    <Text variant="footnote" tone="destructive" align="center" style={styles.error}>
      {text}
    </Text>
  );
}

function AppleButton({ onPress }: { onPress: () => void }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    isAppleSignInAvailable().then(setAvailable);
  }, []);
  if (!available) {
    return (
      <Text variant="subhead" tone="secondary" align="center" style={styles.unavailable}>
        Sign in with Apple isn't available here.
      </Text>
    );
  }
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={28}
      style={styles.apple}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.surface, paddingHorizontal: gutter, paddingTop: 33 },
  loading: { marginVertical: 80 },
  art: { alignItems: 'center' },
  title: { marginTop: 18 },
  sub: { marginTop: 4 },
  subLarge: { marginTop: 6, fontSize: 16, lineHeight: 22 },
  actions: { marginTop: 0 },
  primary: { marginTop: 28 },
  primaryTight: { marginTop: 26 },
  plain: { marginTop: 4 },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: color.signal,
    borderWidth: 3,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkTile: { width: 76, height: 76, borderRadius: 38, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  apple: { height: 56, alignSelf: 'stretch', marginTop: 26 },
  unavailable: { marginTop: 26 },
  error: { marginTop: 12 },
});
