import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '../components/ui';
import { colors } from '../theme';
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

type Availability = 'unknown' | 'checking' | 'free' | 'taken';

/** Pick a username (first time) or edit it later. Friends find you by username. */
export function ProfileSetupScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { session } = useBackend();
  const { profile, setProfile } = useIdentity();
  const editing = !!profile;
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

  const hint =
    formatError ??
    (availability === 'checking' ? 'Checking…' : availability === 'taken' ? 'That username is taken.' : availability === 'free' ? 'Available ✓' : ' ');

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{editing ? 'Edit profile' : 'Choose a username'}</Text>
        <Text style={styles.subtitle}>Friends find and challenge you by your username.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.inputRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              placeholder="your_name"
              placeholderTextColor={colors.muted}
              style={styles.input}
              accessibilityLabel="Username"
            />
          </View>
          <Text style={[styles.hint, (formatError || availability === 'taken') && styles.error]}>{hint}</Text>

          <Text style={[styles.label, { marginTop: 12 }]}>Display name (optional)</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={60}
            placeholder="Shown to friends"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.inputBox]}
            accessibilityLabel="Display name"
          />
          {nameError ? <Text style={[styles.hint, styles.error]}>{nameError}</Text> : null}
        </View>

        {message ? <Text style={[styles.hint, styles.error]}>{message}</Text> : null}
        {saving ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} /> : <Button title={editing ? 'Save' : 'Continue'} onPress={save} />}
        <Button title={editing ? 'Cancel' : 'Later'} kind="secondary" onPress={onCancel} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 12 },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: 4, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 12 },
  at: { color: colors.muted, fontSize: 17 },
  input: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: 12, paddingHorizontal: 4 },
  inputBox: { backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 12, flex: 0 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 6 },
  error: { color: colors.danger },
});
