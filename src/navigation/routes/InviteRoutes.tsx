import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { signInWithApple } from '../../backend/auth';
import { supabase } from '../../backend/supabase';
import { api } from '../../battles/api';
import { friendlyError, personName } from '../../battles/model';
import { inviteApi, type FriendInvitePreview } from '../../invites/api';
import { pendingInvite } from '../../invites/pending';
import { InviteSheet, shareInviteLink } from '../../screens/invite/InviteSheet';
import { InviteQrSheet } from '../../screens/invite/InviteQrSheet';
import { FriendInviteSheet, type FriendInviteState } from '../../screens/invite/FriendInviteSheet';
import { firstRunPending } from './OnboardingRoutes';
import type { Props } from '../types';

/** The last code we saw, per user, so reopening the sheet shows the link at once. */
let cached: { userId: string; code: string } | null = null;

/** Your invite link (invite frames a3, a4, a7). */
export function InviteLinkRoute({ navigation }: Props<'InviteLink'>) {
  const { session } = useBackend();
  const { profile } = useIdentity();
  const userId = session?.user.id ?? null;
  const [code, setCode] = useState<string | null>(() => (cached && cached.userId === userId ? cached.code : null));
  const [error, setError] = useState<string | null>(null);

  const keep = useCallback(
    (next: string) => {
      if (userId) cached = { userId, code: next };
      setCode(next);
    },
    [userId],
  );

  const gateError = !supabase || !userId ? 'Sign in first.' : profile === null ? 'Pick a username first.' : null;
  const ready = !gateError && !!profile;
  useEffect(() => {
    if (!supabase || !ready) return undefined;
    let alive = true;
    inviteApi.mine(supabase).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setError(null);
        keep(r.data);
      } else setError(friendlyError(r.message));
    });
    return () => {
      alive = false;
    };
  }, [ready, keep]);

  return (
    <InviteSheet
      code={gateError ? null : code}
      error={gateError ?? error}
      onClose={() => navigation.goBack()}
      onShowQr={(c) => navigation.navigate('InviteQr', { code: c })}
      onReset={async () => {
        if (!supabase) return;
        const r = await inviteApi.reset(supabase);
        if (r.ok) keep(r.data);
        else setError(friendlyError(r.message));
      }}
    />
  );
}

/** Your QR code (invite frame a6). */
export function InviteQrRoute({ navigation, route }: Props<'InviteQr'>) {
  const { profile } = useIdentity();
  if (!profile) return null;
  return (
    <InviteQrSheet
      code={route.params.code}
      name={personName({ username: profile.username, displayName: profile.displayName })}
      username={profile.username}
      onClose={() => navigation.goBack()}
    />
  );
}

/** A friend's invite link opened in the app (invite frames b1–b6). */
export function FriendInviteRoute({ navigation, route }: Props<'FriendInvite'>) {
  const code = route.params.code;
  const { session } = useBackend();
  const { profile } = useIdentity();
  const userId = session?.user.id ?? null;
  const [preview, setPreview] = useState<FriendInvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'added' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const signedInHere = useRef(false);

  // Remember it for this session (Welcome, Pick a username, and coming back after sign-in).
  useEffect(() => {
    const prev = pendingInvite.get();
    pendingInvite.set({ code, inviter: prev?.code === code ? prev.inviter : null });
  }, [code]);

  // A first launch goes through Welcome first; the sheet comes back when onboarding is done.
  useEffect(() => {
    let alive = true;
    firstRunPending().then((pending) => {
      if (alive && pending) navigation.replace('Welcome');
    });
    return () => {
      alive = false;
    };
  }, [navigation]);

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    inviteApi.preview(supabase, code).then((r) => {
      // Welcome may have replaced this sheet already; it still needs the name.
      if (r.ok && r.data.status === 'invalid') pendingInvite.clear(code);
      else if (r.ok) pendingInvite.setInviter(code, r.data.inviter);
      if (!alive) return;
      if (!r.ok) return setLoadError('Check your connection and try again.');
      setLoadError(null);
      setPreview(r.data);
    });
    return () => {
      alive = false;
    };
    // Signing in changes the answer (own link, already friends).
  }, [code, userId, attempt]);

  // Signed in from this sheet with no username yet: straight to Pick a username.
  useEffect(() => {
    if (signedInHere.current && userId && profile === null) {
      signedInHere.current = false;
      navigation.replace('ProfileSetup');
    }
  }, [userId, profile, navigation]);

  const inviter = preview?.inviter ?? null;
  const name = inviter ? personName(inviter) : '';
  const state: FriendInviteState = (() => {
    if (!supabase) return { kind: 'error', message: 'Sign-in is not available in this build.' };
    if (loadError) return { kind: 'error', message: loadError };
    if (!preview) return { kind: 'loading' };
    if (preview.status === 'invalid' || !inviter) return { kind: 'invalid' };
    if (outcome === 'added') return { kind: 'added', name };
    if (!userId) return { kind: 'signedOut', name, error: actionError };
    if (profile === undefined) return { kind: 'loading' };
    if (profile === null) return { kind: 'needsUsername', name };
    if (preview.status === 'own') return { kind: 'own', name: personName(profile) };
    if (preview.status === 'friends') return { kind: 'already', name };
    return { kind: 'add', name, username: inviter.username, busy, error: actionError };
  })();

  const finished = state.kind === 'added' || state.kind === 'already' || state.kind === 'own' || state.kind === 'invalid';
  useEffect(() => {
    if (finished) pendingInvite.clear(code);
  }, [finished, code]);

  const close = () => {
    // Signed out, Not now keeps the invite for later in this session.
    if (state.kind !== 'signedOut' && state.kind !== 'needsUsername') pendingInvite.clear(code);
    navigation.goBack();
  };

  return (
    <FriendInviteSheet
      state={state}
      onClose={close}
      onAdd={async () => {
        if (!supabase || busy) return;
        setBusy(true);
        setActionError(null);
        const r = await inviteApi.redeem(supabase, code);
        setBusy(false);
        if (!r.ok) return setActionError(friendlyError(r.message));
        if (r.data === 'added') {
          api.kickNotify(supabase);
          setOutcome('added');
        } else {
          setPreview((p) => (p ? { ...p, status: r.data === 'already' ? 'friends' : r.data === 'own' ? 'own' : 'invalid' } : p));
        }
      }}
      onChallenge={() => {
        pendingInvite.clear(code);
        navigation.replace('NewBattle', inviter?.userId ? { friendIds: [inviter.userId] } : undefined);
      }}
      onShare={() => shareInviteLink(code)}
      onSearch={() => {
        pendingInvite.clear(code);
        navigation.replace('Friends', { search: true });
      }}
      onSignIn={async () => {
        setActionError(null);
        const r = await signInWithApple();
        if (r.ok) signedInHere.current = true;
        else if (!r.cancelled) setActionError(r.message ?? 'Sign-in failed.');
      }}
      onPickUsername={() => navigation.replace('ProfileSetup')}
      onRetry={() => {
        setLoadError(null);
        setAttempt((n) => n + 1);
      }}
    />
  );
}
