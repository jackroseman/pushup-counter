import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';

import { SettingsScreen } from '../../screens/SettingsScreen';
import { DailyReminderScreen, QuietHoursScreen } from '../../screens/DailyReminderScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { isAppleSignInAvailable, signInWithApple } from '../../backend/auth';
import { deviceTimeZone } from '../../backend/profile';
import { addCalendarDays, localDate } from '../../progress';
import { backupValue, clockLabel, goalValue, quietHoursLabel, reminderPreview, reminderTarget } from '../../progress/settingsView';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import type { Props } from '../types';
import { useFocusNow } from './useFocusNow';
import { useDiscardGuard, useSaveHeader } from '../draft';
import { quietDirty, quietDraftOf, reminderDirty, reminderDraftOf } from '../../progress/draft';

type Permission = 'granted' | 'denied' | 'undetermined';

/** The phone's notification permission, read again whenever the screen comes back into view. */
function useNotificationPermission(navigation: Props<'Settings'>['navigation']): [Permission | null, () => void] {
  const [permission, setPermission] = useState<Permission | null>(null);
  const read = useCallback(() => {
    Notifications.getPermissionsAsync()
      .then((p) => setPermission(p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied'))
      .catch(() => setPermission(null));
  }, []);
  useEffect(() => {
    read();
    return navigation.addListener('focus', read);
  }, [navigation, read]);
  return [permission, read];
}

/** Was the Account screen (frame 29, E15). */
export function SettingsRoute({ navigation }: Props<'Settings'>) {
  const { settings, updateSettings, nudges, enrollments } = useAppState();
  const { configured, session } = useBackend();
  const { profile, profileError, refreshProfile, sync, push, signOut, deleteAccount } = useIdentity();
  const [permission, rereadPermission] = useNotificationPermission(navigation);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const today = localDate(useFocusNow(navigation), deviceTimeZone());

  const onNotifications = async () => {
    setMessage(null);
    if (permission === 'undetermined') {
      if (session && profile) {
        const r = await push.enable();
        if (!r.ok && r.message) setMessage(r.message);
      } else {
        await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }).catch(() => null);
      }
      rereadPermission();
      return;
    }
    Linking.openSettings().catch(() => {});
  };

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
            const r = await deleteAccount();
            if (r.ok) navigation.goBack();
            else setMessage(r.message ?? 'Could not delete the account. Try again.');
          },
        },
      ],
    );

  const account = session
    ? {
        profileValue: profile ? `@${profile.username}` : profile === null ? 'Not set' : profileError ? 'Retry' : '',
        onProfile: () => (profile === undefined && profileError ? refreshProfile() : navigation.navigate('ProfileSetup')),
        backupValue: backupValue(sync.status, sync.running),
        onBackup: () => {
          if (!sync.running) void sync.syncNow();
        },
        onSignOut: () => {
          void signOut().then(() => navigation.goBack());
        },
        onDelete: confirmDelete,
      }
    : null;

  const signIn =
    !session && configured && appleAvailable
      ? async () => {
          setMessage(null);
          const r = await signInWithApple();
          if (!r.ok && !r.cancelled) setMessage(r.message ?? 'Sign-in failed.');
        }
      : null;

  return (
    <Frame kind="header">
      <SettingsScreen
        goalValue={goalValue(enrollments, today)}
        onGoal={() => navigation.navigate('GoalSetup')}
        speakQuality={settings.speakQuality}
        onSpeakQuality={(speakQuality) => updateSettings({ ...settings, speakQuality })}
        notificationsValue={permission === 'granted' ? 'On' : permission == null ? '' : 'Off'}
        onNotifications={onNotifications}
        reminderValue={nudges.dailyNudge ? clockLabel(nudges.nudgeLocalTime) : 'Off'}
        onReminder={() => navigation.navigate('DailyReminder')}
        quietHoursValue={quietHoursLabel(nudges.quietStart, nudges.quietEnd)}
        onQuietHours={() => navigation.navigate('QuietHours')}
        account={account}
        signIn={signIn}
        message={message}
        version={Application.nativeApplicationVersion}
      />
    </Frame>
  );
}

/** Settings › Daily reminder (frame 30). Edits are a draft until Save; saves to the same prefs as before (`notification_prefs` when signed in). */
export function DailyReminderRoute({ navigation }: Props<'DailyReminder'>) {
  const { nudges, updateNudges, enrollments } = useAppState();
  const today = localDate(useFocusNow(navigation), deviceTimeZone());
  const target = reminderTarget(enrollments, today, addCalendarDays);
  const [draft, setDraft] = useState(() => reminderDraftOf(nudges));
  const dirty = reminderDirty(reminderDraftOf(nudges), draft);
  const leave = useDiscardGuard(navigation, dirty);
  const save = () => {
    updateNudges({ ...nudges, ...draft });
    leave();
  };
  useSaveHeader(navigation, { canSave: dirty, onSave: save });
  // No goal means no reminder (E15): leave if the goal goes away while this is open.
  useEffect(() => {
    if (goalValue(enrollments, today) == null && target == null) leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollments, today, target]);
  return (
    <Frame kind="header">
      <DailyReminderScreen
        enabled={draft.dailyNudge}
        onEnabled={(dailyNudge) => setDraft((d) => ({ ...d, dailyNudge }))}
        time={draft.nudgeLocalTime}
        onTime={(nudgeLocalTime) => setDraft((d) => ({ ...d, nudgeLocalTime }))}
        preview={target != null ? reminderPreview(target) : null}
      />
    </Frame>
  );
}

/** Settings › Quiet hours. A draft until Save. */
export function QuietHoursRoute({ navigation }: Props<'QuietHours'>) {
  const { nudges, updateNudges } = useAppState();
  const [draft, setDraft] = useState(() => quietDraftOf(nudges));
  const dirty = quietDirty(quietDraftOf(nudges), draft);
  const leave = useDiscardGuard(navigation, dirty);
  const save = () => {
    updateNudges({ ...nudges, ...draft });
    leave();
  };
  useSaveHeader(navigation, { canSave: dirty, onSave: save });
  return (
    <Frame kind="header">
      <QuietHoursScreen
        start={draft.quietStart}
        end={draft.quietEnd}
        onStart={(quietStart) => setDraft((d) => ({ ...d, quietStart }))}
        onEnd={(quietEnd) => setDraft((d) => ({ ...d, quietEnd }))}
      />
    </Frame>
  );
}
