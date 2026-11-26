import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { EmptyState, color } from '../../ui';
import { CompeteSignedOut } from './SignedOut';

/**
 * Compete needs an account with a username. Signed out it is the sign-in pitch (frame 16);
 * without a username it asks for one.
 */
export function CompeteGate({ children, onProfile }: { children: React.ReactNode; onProfile: () => void }) {
  const { configured, session } = useBackend();
  const { profile, profileError } = useIdentity();
  if (!configured || !session) return <CompeteSignedOut configured={configured} />;
  if (profile === undefined) {
    if (profileError) return <EmptyState icon="info" title="Couldn't load your account" message={profileError} />;
    return <ActivityIndicator style={styles.loading} color={color.secondary} />;
  }
  if (profile === null) {
    return (
      <EmptyState
        icon="person"
        title="Pick a username"
        message="Friends find you by your username."
        actionTitle="Pick a username"
        onAction={onProfile}
      />
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({ loading: { marginTop: 48 } });
