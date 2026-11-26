import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import { PENDING_DISPLAY_NAME_KEY } from '../backend/auth';
import { supabase } from '../backend/supabase';
import {
  displayNameError,
  isUsernameAvailable,
  normalizeUsername,
  saveProfile,
  suggestUsername,
  usernameError,
} from '../backend/profile';
import { profileDraftState, type Availability } from '../progress/draft';
import { Button, Card, Icon, IconButton, SectionHeader, Text, color, gutter, space, type } from '../ui';

export type ProfileForm = ReturnType<typeof useProfileForm>;

/**
 * State and save for the username screen. Editing an existing profile is a draft: `dirty` / `canSave`
 * drive the header Save button (see ProfileSetupRoute). First-time setup keeps its Continue button.
 */
export function useProfileForm({ onDone }: { onDone: () => void }) {
  const { session } = useBackend();
  const { profile, setProfile } = useIdentity();
  const [editing] = useState(() => !!profile); // stays put after the first save, while the screen pops
  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [availability, setAvailability] = useState<Availability>('unknown');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const check = useRef(0);

  useEffect(() => {
    if (editing) return;
    AsyncStorage.getItem(PENDING_DISPLAY_NAME_KEY).then((name) => {
      if (name) setDisplayName((d) => d || name);
      setUsername((u) => u || suggestUsername(name));
    });
  }, [editing]);

  const normalized = normalizeUsername(username);
  const formatError = normalized ? usernameError(normalized) : null;
  const nameError = displayNameError(displayName);

  useEffect(() => {
    if (!supabase || formatError || !normalized || normalized === profile?.username) {
      setAvailability('unknown');
      return;
    }
    const n = ++check.current;
    setAvailability('checking');
    const t = setTimeout(() => {
      isUsernameAvailable(supabase!, normalized).then(
        (ok) => n === check.current && setAvailability(ok ? 'free' : 'taken'),
        () => n === check.current && setAvailability('unknown'),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [normalized, formatError, profile?.username]);

  const draftState = profile ? profileDraftState(profile, { username, displayName }, availability) : { dirty: false, canSave: false };

  const save = async () => {
    if (!supabase || !session || formatError || nameError || !normalized || availability === 'taken') return;
    setSaving(true);
    setMessage(null);
    const r = await saveProfile(supabase, { id: session.user.id, username: normalized, displayName, timeZone: profile?.timeZone }, !editing);
    setSaving(false);
    if (!r.ok) {
      if (r.reason === 'taken') setAvailability('taken');
      setMessage(r.message);
      return;
    }
    await AsyncStorage.removeItem(PENDING_DISPLAY_NAME_KEY).catch(() => {});
    setProfile(r.profile);
    onDone();
  };

  return { editing, username, setUsername, displayName, setDisplayName, availability, saving, message, formatError, nameError, save, ...draftState };
}

/** The line under the username field: format problem, checking, taken, or Available. */
export function usernameStatus(formatError: string | null, availability: Availability): { text: string; tone: 'secondary' | 'signal' | 'destructive' } | null {
  if (formatError) return { text: formatError, tone: 'destructive' };
  if (availability === 'checking') return { text: 'Checking…', tone: 'secondary' };
  if (availability === 'taken') return { text: 'That username is taken.', tone: 'destructive' };
  if (availability === 'free') return { text: 'Available', tone: 'signal' };
  return null;
}

/**
 * Pick a username (frame 17): right after signing in, or from Compete / You / Settings while there
 * is none. Back leaves it for later. Editing later uses the same fields under a native header with Save.
 */
export function ProfileSetupScreen({ form, onCancel }: { form: ProfileForm; onCancel: () => void }) {
  const { editing, username, setUsername, displayName, setDisplayName, availability, saving, message, formatError, nameError, save } = form;
  const status = usernameStatus(formatError, availability);
  const canContinue = !!username.trim() && !formatError && !nameError && availability !== 'taken' && availability !== 'checking';

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? null : (
          <>
            <View style={styles.nav}>
              <IconButton icon="back" accessibilityLabel="Back" onPress={onCancel} />
            </View>
            <Text variant="title1" accessibilityRole="header" style={styles.title}>
              Pick a username
            </Text>
            <Text variant="subhead" style={styles.subtitle}>
              This is how friends find you.
            </Text>
          </>
        )}
        <Card padding={0} style={[styles.field, editing && styles.fieldEditing]}>
          <View style={styles.row}>
            <Text variant="body" tone="tertiary">
              @
            </Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={!editing}
              maxLength={24}
              placeholder="username"
              placeholderTextColor={color.tertiary}
              style={styles.input}
              accessibilityLabel="Username"
            />
            {availability === 'free' && !formatError ? <Icon name="check" size={18} color={color.signal} /> : null}
          </View>
        </Card>
        <Text variant="footnote" tone={status?.tone ?? 'secondary'} style={styles.status}>
          {status?.text ?? ' '}
        </Text>

        <SectionHeader title="Display name" style={styles.section} />
        <Card padding={0}>
          <View style={styles.row}>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
              placeholder="Optional"
              placeholderTextColor={color.tertiary}
              style={styles.input}
              accessibilityLabel="Display name"
            />
          </View>
        </Card>
        {nameError ? (
          <Text variant="footnote" tone="destructive" style={styles.status}>
            {nameError}
          </Text>
        ) : null}
        {message ? (
          <Text variant="footnote" tone="destructive" style={styles.status}>
            {message}
          </Text>
        ) : null}
      </ScrollView>
      {editing ? null : (
        <View style={styles.footer}>
          <Button title="Continue" onPress={save} loading={saving} disabled={!canContinue} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: space.lg },
  nav: { height: 44, flexDirection: 'row', alignItems: 'center' },
  title: { marginTop: 20 },
  subtitle: { fontSize: 17, lineHeight: 22, marginTop: 6 },
  field: { marginTop: 24 },
  fieldEditing: { marginTop: space.md },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md },
  input: { flex: 1, fontSize: type.body.fontSize, color: color.label, paddingVertical: 14 },
  status: { marginTop: 8, marginHorizontal: 4 },
  section: { marginTop: space.sm },
  footer: { paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: space.md },
});
