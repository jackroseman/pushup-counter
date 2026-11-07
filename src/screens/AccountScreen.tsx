import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Button } from '../components/ui';
import { colors } from '../theme';
import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import { isAppleSignInAvailable, signInWithApple } from '../backend/auth';
import { Settings } from '../storage/settings';
import { historyStore } from '../session/useSession';
import { NudgePrefs, OLD_SETS_NOTE, PERSONAL_BACKFILL_MS, shiftClock } from '../progress';

/** Account: profile, counting preferences, backup, sign out, delete account. */
export function AccountScreen({
  settings,
  onChangeSettings,
  nudges,
  onChangeNudges,
  onEditProfile,
  onBack,
}: {
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  nudges: NudgePrefs;
  onChangeNudges: (prefs: NudgePrefs) => void;
  onEditProfile: () => void;
  onBack: () => void;
}) {
  const { configured, session } = useBackend();
  const { profile, profileError, refreshProfile, sync, push, signOut, deleteAccount } = useIdentity();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oldSets, setOldSets] = useState(false);

  useEffect(() => {
    if (!session) {
      setOldSets(false);
      return;
    }
    let alive = true;
    historyStore
      .load()
      .then((rows) => {
        if (alive) setOldSets(rows.some((row) => Date.now() - row.startedAt > PERSONAL_BACKFILL_MS));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  if (!configured) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Account</Text>
        <CountingCard settings={settings} onChangeSettings={onChangeSettings} />
        <ReminderCard nudges={nudges} onChangeNudges={onChangeNudges} signedIn={false} />
        <Text style={styles.text}>Sign in with Apple is not available in this build.</Text>
        <Button title="Back" onPress={onBack} />
      </View>
    );
  }

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Account</Text>
        <CountingCard settings={settings} onChangeSettings={onChangeSettings} />
        <ReminderCard nudges={nudges} onChangeNudges={onChangeNudges} signedIn={false} />
        <Text style={styles.text}>Sign in to back up your sets and challenge friends. Solo counting keeps working without an account.</Text>
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
      </ScrollView>
    );
  }

  const confirmDelete = () =>
    Alert.alert(
      'Delete account?',
      'This permanently deletes your profile, friends, backed-up sets and challenge entries. Sets saved on this phone stay here. This cannot be undone.',
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
      <CountingCard settings={settings} onChangeSettings={onChangeSettings} />
      <ReminderCard nudges={nudges} onChangeNudges={onChangeNudges} signedIn />

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
            {oldSets ? <Text style={styles.text}>{OLD_SETS_NOTE}</Text> : null}
            {sync.error ? <Text style={styles.error}>Last backup failed: {sync.error}</Text> : null}
            {sync.running ? <ActivityIndicator color={colors.accent} /> : <Button title="Back up now" kind="secondary" style={inCard} onPress={sync.syncNow} />}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Notifications</Text>
            {push.registered ? (
              <>
                <Text style={styles.text}>On. You will hear about challenges and results.</Text>
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
                    : 'Get notified when a friend challenges you or a challenge ends.'}
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

function CountingCard({ settings, onChangeSettings }: { settings: Settings; onChangeSettings: (s: Settings) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.section}>Counting</Text>
      <SettingRow
        label="Speak rep quality"
        hint='Says "7, shallow" for reps that aren’t full depth.'
        value={settings.speakQuality}
        onChange={(v) => onChangeSettings({ ...settings, speakQuality: v })}
      />
      <SettingRow label="Haptics" value={settings.haptics} onChange={(v) => onChangeSettings({ ...settings, haptics: v })} />
    </View>
  );
}

function ReminderCard({
  nudges,
  onChangeNudges,
  signedIn,
}: {
  nudges: NudgePrefs;
  onChangeNudges: (prefs: NudgePrefs) => void;
  signedIn: boolean;
}) {
  const set = (patch: Partial<NudgePrefs>) => onChangeNudges({ ...nudges, ...patch });
  return (
    <View style={styles.card}>
      <Text style={styles.section}>Reminders</Text>
      <SettingRow
        label="Daily reminder"
        hint="On days you have a goal and have not done a set."
        value={nudges.dailyNudge}
        onChange={(dailyNudge) => set({ dailyNudge })}
      />
      {nudges.dailyNudge ? (
        <TimeStepper label="Reminder time" value={nudges.nudgeLocalTime} onChange={(nudgeLocalTime) => set({ nudgeLocalTime })} />
      ) : null}
      <TimeStepper label="Quiet hours start" value={nudges.quietStart} onChange={(quietStart) => set({ quietStart })} />
      <TimeStepper label="Quiet hours end" value={nudges.quietEnd} onChange={(quietEnd) => set({ quietEnd })} />
      <Text style={styles.hint}>Quiet hours hold a reminder until they end. They do not drop it.</Text>
      {signedIn ? (
        <>
          <SettingRow label="Pass ping" hint="When a friend passes you this week." value={nudges.passPing} onChange={(passPing) => set({ passPing })} />
          <SettingRow
            label="Sunday recap"
            hint="A push about the week that just ended."
            value={nudges.weeklyRecap}
            onChange={(weeklyRecap) => set({ weeklyRecap })}
          />
          {nudges.weeklyRecap ? (
            <TimeStepper label="Sunday recap time" value={nudges.recapLocalTime} onChange={(recapLocalTime) => set({ recapLocalTime })} />
          ) : null}
        </>
      ) : (
        <Text style={styles.text}>Pass pings and the Sunday push need an account. This phone still reminds you each day.</Text>
      )}
    </View>
  );
}

function TimeStepper({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Earlier ${label}`} hitSlop={8} onPress={() => onChange(shiftClock(value, -30))}>
        <Text style={styles.step}>−</Text>
      </Pressable>
      <Text style={styles.clock}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Later ${label}`} hitSlop={8} onPress={() => onChange(shiftClock(value, 30))}>
        <Text style={styles.step}>+</Text>
      </Pressable>
    </View>
  );
}

function SettingRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 12, marginBottom: 12 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 8, marginBottom: 12 },
  section: { color: colors.text, fontSize: 17, fontWeight: '700' },
  name: { color: colors.text, fontSize: 20, fontWeight: '700' },
  text: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  clock: { color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  step: { color: colors.accent, fontSize: 22, fontWeight: '700', paddingHorizontal: 10 },
  error: { color: colors.danger, fontSize: 13 },
  apple: { height: 48, width: '100%', marginVertical: 12 },
});
