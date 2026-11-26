import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ICON_ROW_INSET, ListGroup, ListRow, SectionHeader, Text, color, gutter } from '../ui';

export interface SettingsAccount {
  /** `@sunny`, `Not set` while there is no username, or empty while it loads. */
  profileValue: string;
  onProfile: () => void;
  backupValue: string;
  onBackup: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}

/**
 * Settings behind the You gear (frame 29). One icon style, grouped rows, destructive actions at the
 * bottom. With no daily goal (E15) the reminder rows become one "Set a daily goal to get reminders" row.
 */
export function SettingsScreen({
  goalValue,
  onGoal,
  speakQuality,
  onSpeakQuality,
  notificationsValue,
  onNotifications,
  reminderValue,
  onReminder,
  quietHoursValue,
  onQuietHours,
  account,
  signIn,
  message,
  version,
}: {
  /** Null = no daily goal (E15). */
  goalValue: string | null;
  onGoal: () => void;
  speakQuality: boolean;
  onSpeakQuality: (value: boolean) => void;
  notificationsValue: string;
  onNotifications: () => void;
  /** `6:00 PM`, or `Off`. */
  reminderValue: string;
  onReminder: () => void;
  quietHoursValue: string;
  onQuietHours: () => void;
  /** Signed in. */
  account: SettingsAccount | null;
  /** Signed out and Sign in with Apple is available. */
  signIn: (() => void) | null;
  message: string | null;
  version: string | null;
}) {
  const hasGoal = goalValue != null;
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <SectionHeader title="Goal" />
      <ListGroup inset={ICON_ROW_INSET}>
        <ListRow icon="target" title="Daily goal" value={goalValue ?? 'Not set'} chevron onPress={onGoal} />
      </ListGroup>

      <SectionHeader title="During a set" />
      <ListGroup inset={ICON_ROW_INSET}>
        <ListRow icon="speaker" title="Speak rep quality" switchValue={speakQuality} onSwitchChange={onSpeakQuality} />
      </ListGroup>

      <SectionHeader title="Notifications" />
      <ListGroup inset={ICON_ROW_INSET}>
        <ListRow icon="bell" title="Notifications" value={notificationsValue} chevron onPress={onNotifications} />
        {hasGoal ? <ListRow icon="clock" title="Daily reminder" value={reminderValue} chevron onPress={onReminder} /> : null}
        {hasGoal ? <ListRow icon="moon" title="Quiet hours" value={quietHoursValue} chevron onPress={onQuietHours} /> : null}
        {!hasGoal ? <ListRow icon="clock" title="Set a daily goal to get reminders" chevron onPress={onGoal} /> : null}
      </ListGroup>

      {account ? (
        <>
          <SectionHeader title="Account" />
          <ListGroup inset={ICON_ROW_INSET}>
            <ListRow icon="person" title="Profile" value={account.profileValue} chevron onPress={account.onProfile} />
            <ListRow icon="check" title="Sets backed up" value={account.backupValue} chevron onPress={account.onBackup} />
          </ListGroup>
          <ListGroup style={styles.actions}>
            <ListRow title="Sign out" onPress={account.onSignOut} />
            <ListRow title="Delete account" destructive onPress={account.onDelete} />
          </ListGroup>
        </>
      ) : signIn ? (
        <>
          <SectionHeader title="Account" />
          <ListGroup inset={ICON_ROW_INSET}>
            <ListRow icon="person" title="Sign in" subtitle="Save your sets and compete with friends" chevron onPress={signIn} />
          </ListGroup>
        </>
      ) : null}

      {message ? (
        <Text variant="footnote" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {version ? (
        <Text variant="caption" align="center" style={styles.version}>
          Version {version}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: 32 },
  actions: { marginTop: 20 },
  message: { marginTop: 12, marginHorizontal: 4 },
  version: { marginTop: 24 },
});
