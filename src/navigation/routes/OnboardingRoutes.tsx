import React, { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

import { WelcomeScreen } from '../../screens/onboarding/WelcomeScreen';
import { GoalPickScreen } from '../../screens/onboarding/GoalPickScreen';
import { HowItWorksScreen } from '../../screens/onboarding/HowItWorksScreen';
import { signInWithApple } from '../../backend/auth';
import { supabase } from '../../backend/supabase';
import { historyStore } from '../../session/useSession';
import { faceTrackingSupported } from '../../sensors';
import { loadOnboarded, markOnboarded, needsOnboarding } from '../../progress/onboarding';
import { useAppState } from '../appState';
import { personName } from '../../battles/model';
import { pendingInvite, usePendingInvite } from '../../invites/pending';
import { Frame } from '../frame';
import type { Props, RootStackParamList } from '../types';

/** Once the gate has said no (or onboarding finished), Today never waits for it again. */
let settled = false;

type Nav = { navigate: (route: 'Welcome') => void };

/** Whether first-run onboarding still has to run (same check as the gate). */
export async function firstRunPending(): Promise<boolean> {
  if (settled) return false;
  const [stored, setCount, signedIn] = await Promise.all([
    loadOnboarded(AsyncStorage),
    historyStore
      .load()
      .then((rows) => rows.length)
      .catch(() => 0),
    supabase
      ? supabase.auth
          .getSession()
          .then(({ data }) => !!data.session)
          .catch(() => false)
      : Promise.resolve(false),
  ]);
  return needsOnboarding({ ...stored, setCount, signedIn });
}

/**
 * First-run gate, run when Today gets focus. Returns false while it's checking so Today stays
 * blank instead of flashing before Welcome. Existing users (old how-to seen, sets on this
 * phone, or a signed-in session) skip onboarding.
 */
export function useOnboardingGate(navigation: Nav): boolean {
  const [ready, setReady] = useState(settled);
  useFocusEffect(
    useCallback(() => {
      if (settled) return undefined;
      let alive = true;
      firstRunPending().then((pending) => {
        if (!alive) return;
        if (pending) navigation.navigate('Welcome');
        else settled = true;
        setReady(true);
      });
      return () => {
        alive = false;
      };
    }, [navigation]),
  );
  return ready;
}

type Finisher = {
  reset: (state: { index: number; routes: { name: keyof RootStackParamList; params?: RootStackParamList[keyof RootStackParamList] }[] }) => void;
};

/**
 * Mark first run done and land on Today (optionally with a set open on top). If an invite
 * link opened the app, its Add friend sheet opens over Today instead (invite frame b8).
 */
function finish(navigation: Finisher, thenSet = false) {
  settled = true;
  markOnboarded(AsyncStorage).catch(() => {});
  const invite = pendingInvite.get();
  if (invite) navigation.reset({ index: 1, routes: [{ name: 'Main' }, { name: 'FriendInvite', params: { code: invite.code } }] });
  else navigation.reset(thenSet ? { index: 1, routes: [{ name: 'Main' }, { name: 'Session' }] } : { index: 0, routes: [{ name: 'Main' }] });
}

export function WelcomeRoute({ navigation }: Props<'Welcome'>) {
  const invite = usePendingInvite();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Frame kind="bare">
      <WelcomeScreen
        signingIn={signingIn}
        error={error}
        invitedBy={invite?.inviter ? personName(invite.inviter) : null}
        onStart={() => navigation.navigate('GoalPick')}
        onSignIn={async () => {
          setError(null);
          setSigningIn(true);
          const r = await signInWithApple();
          setSigningIn(false);
          if (r.ok) finish(navigation);
          else if (!r.cancelled) setError(r.message ?? 'Sign-in failed.');
        }}
      />
    </Frame>
  );
}

export function GoalPickRoute({ navigation }: Props<'GoalPick'>) {
  const { saveChoice } = useAppState();
  const [saving, setSaving] = useState(false);
  return (
    <Frame kind="bare">
      <GoalPickScreen
        saving={saving}
        onBack={() => navigation.goBack()}
        onSkip={() => finish(navigation)}
        onContinue={(choice) => {
          setSaving(true);
          void saveChoice(choice).finally(() => {
            setSaving(false);
            navigation.navigate('HowItWorks', { onboarding: true });
          });
        }}
      />
    </Frame>
  );
}

export function HowItWorksRoute({ navigation, route }: Props<'HowItWorks'>) {
  const onboarding = !!route.params?.onboarding;
  return (
    <Frame kind="bare">
      <HowItWorksScreen
        step={onboarding ? 3 : null}
        canTry={faceTrackingSupported()}
        onBack={() => navigation.goBack()}
        onTry={() => (onboarding ? finish(navigation, true) : navigation.replace('Session'))}
        onLater={() => (onboarding ? finish(navigation) : navigation.goBack())}
      />
    </Frame>
  );
}
