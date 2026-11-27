import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { NOTIFICATION_PROMPT_COPY } from '../notifications/prompt';
import { Button, ICON_ROW_INSET, ListGroup, ListRow, SectionHeader, Text, color, gutter } from '../ui';

/** Friend pings, signed in only (no mockup spot; kept under Notifications). Toggles save at once. */
export interface SettingsPings {
  passPing: boolean;
  onPassPing: (value: boolean) => void;
  weeklyRecap: boolean;
  onWeeklyRecap: (value: boolean) => void;
}

export interface SettingsAccount {
  /** `@sunny`, `Not set` while there is no username, or empty while it loads. */
  profileValue: string;
  onProfile: () => void;
  /** Opens your invite link sheet; absent until there is a username. */
  onInviteLink?: () => void;
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
  countOutLoud,
  onCountOutLoud,
  notificationsValue,
  onNotifications,
  reminderValue,
  onReminder,
  quietHoursValue,
  onQuietHours,
  pings,
  account,
  signIn,
  message,
  version,
}: {
  /** Null = no daily goal (E15). */
  goalValue: string | null;
  onGoal: () => void;
  countOutLoud: boolean;
  onCountOutLoud: (value: boolean) => void;
  notificationsValue: string;
  onNotifications: () => void;
  /** `6:00 PM`, or `Off`. */
  reminderValue: string;
  onReminder: () => void;
  quietHoursValue: string;
  onQuietHours: () => void;
  /** Signed in: Pass ping and Sunday recap. */
  pings: SettingsPings | null;
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
        <ListRow icon="speaker" title="Count out loud" switchValue={countOutLoud} onSwitchChange={onCountOutLoud} />
      </ListGroup>

      <SectionHeader title="Notifications" />
      <ListGroup inset={ICON_ROW_INSET}>
        <ListRow
          icon="bell"
          title="Notifications"
          subtitle={notificationsValue === 'Off' ? NOTIFICATION_PROMPT_COPY.line : undefined}
          subtitleNumberOfLines={3}
          value={notificationsValue}
          trailing={
            notificationsValue === 'Off' ? (
              <Button title={NOTIFICATION_PROMPT_COPY.bannerTurnOn} kind="tinted" size="small" onPress={onNotifications} />
            ) : undefined
          }
          chevron={notificationsValue !== 'Off'}
          onPress={notificationsValue === 'Off' ? undefined : onNotifications}
        />
        {hasGoal ? <ListRow icon="clock" title="Daily reminder" value={reminderValue} chevron onPress={onReminder} /> : null}
        {hasGoal ? <ListRow icon="moon" title="Quiet hours" value={quietHoursValue} chevron onPress={onQuietHours} /> : null}
        {!hasGoal ? <ListRow icon="clock" title="Set a daily goal to get reminders" chevron onPress={onGoal} /> : null}
        {pings ? (
          <ListRow
            icon="trophy"
            title="Pass ping"
            subtitle="When a friend passes you"
            switchValue={pings.passPing}
            onSwitchChange={pings.onPassPing}
          />
        ) : null}
        {pings ? (
          <ListRow
            icon="calendar"
            title="Sunday recap"
            subtitle="How your week went"
            switchValue={pings.weeklyRecap}
            onSwitchChange={pings.onWeeklyRecap}
          />
        ) : null}
      </ListGroup>

      {account ? (
        <>
          <SectionHeader title="Account" />
          <ListGroup inset={ICON_ROW_INSET}>
            <ListRow icon="person" title="Profile" value={account.profileValue} chevron onPress={account.onProfile} />
            {account.onInviteLink ? <ListRow icon="link" title="Invite link" chevron onPress={account.onInviteLink} /> : null}
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
