import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../ui';
import { gutter } from '../../ui/tokens';
import { BrandMark } from '../today/BrandMark';

/** Frame 1. */
export function WelcomeScreen({
  onStart,
  onSignIn,
  signingIn,
  error,
}: {
  onStart: () => void;
  onSignIn: () => void;
  signingIn?: boolean;
  error?: string | null;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <BrandMark variant="icon" />
        <Text style={styles.name} accessibilityRole="header">
          Rep Royale
        </Text>
        <Text variant="body" tone="secondary" align="center" style={styles.lead}>
          {'Push-ups every day.\nYour phone counts every rep.'}
        </Text>
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
  error: { marginBottom: 12 },
});
