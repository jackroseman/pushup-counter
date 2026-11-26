import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar, Button, Text, color } from '../../ui';
import { gutter, radius } from '../../ui/tokens';
import { BrandMark } from '../today/BrandMark';

/** Frame 1. */
export function WelcomeScreen({
  onStart,
  onSignIn,
  signingIn,
  error,
  invitedBy,
}: {
  onStart: () => void;
  onSignIn: () => void;
  signingIn?: boolean;
  error?: string | null;
  /** Name of the person whose invite link opened the app (invite frame b8). */
  invitedBy?: string | null;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <BrandMark />
        <Text style={styles.name} accessibilityRole="header">
          Rep Royale
        </Text>
        <Text variant="body" tone="secondary" align="center" style={styles.lead}>
          {'Push-ups every day.\nYour phone counts every rep.'}
        </Text>
        {invitedBy ? (
          <View style={styles.invite}>
            <Avatar name={invitedBy} size={38} />
            <View style={styles.inviteText}>
              <Text variant="subhead" weight="600" tone="label">{`${invitedBy} invited you`}</Text>
              <Text variant="footnote">{`You can add ${invitedBy} after you sign in.`}</Text>
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        {error ? (
          <Text variant="footnote" tone="destructive" align="center" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Button title="Get started" onPress={onStart} />
        <Button title="I already have an account" kind="plain" onPress={onSignIn} loading={signingIn} style={styles.plain} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: gutter + 8 },
  hero: { alignItems: 'center', marginTop: 150 },
  name: { marginTop: 34, fontSize: 40, lineHeight: 48, fontWeight: '800', letterSpacing: -1.6 },
  lead: { marginTop: 12, fontSize: 19, lineHeight: 27 },
  actions: { marginTop: 'auto', marginBottom: 22 },
  plain: { marginTop: 4 },
  invite: {
    marginTop: 44,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.separator,
  },
  inviteText: { flex: 1 },
  error: { marginBottom: 12 },
});
