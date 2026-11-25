import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import {
  NOTIFICATION_PROMPT_COPY,
  notificationSurface,
  readNotificationSnooze,
  snoozeUntil,
  writeNotificationSnooze,
} from '../notifications/prompt';
import { colors } from '../theme';
import { Button } from './ui';

function Bell({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3.2a5.2 5.2 0 0 0-5.2 5.2v2.2c0 .8-.3 1.6-.9 2.2L4.6 14.2V16h14.8v-1.8l-1.3-1.4c-.6-.6-.9-1.4-.9-2.2V8.4A5.2 5.2 0 0 0 12 3.2z"
        fill={colors.accent}
      />
      <Path d="M9.6 16.6a2.4 2.4 0 0 0 4.8 0" fill={colors.accent} />
    </Svg>
  );
}

/** Banner under the challenge header, and the sheet after creating, accepting, or joining. */
export function ChallengeNotifications({ justActed, onConsumed }: { justActed: boolean; onConsumed: () => void }) {
  const { session } = useBackend();
  const { push } = useIdentity();
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    readNotificationSnooze(AsyncStorage).then((until) => {
      if (!alive) return;
      setSnoozedUntil(until);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!session || !ready || !push.checked) return null;
  const surface = notificationSurface({
    permission: push.permission,
    justActed,
    snoozedUntil,
    now: Date.now(),
  });

  const turnOn = () => {
    onConsumed();
    void push.enable();
  };
  const notNow = () => {
    const until = snoozeUntil(Date.now());
    setSnoozedUntil(until);
    onConsumed();
    writeNotificationSnooze(AsyncStorage, until).catch(() => {});
  };

  return (
    <>
      {surface === 'banner' ? (
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Bell size={18} />
          </View>
          <Text style={styles.bannerText}>{NOTIFICATION_PROMPT_COPY.banner}</Text>
          <Pressable accessibilityRole="button" onPress={turnOn} style={styles.pill}>
            <Text style={styles.pillText}>{NOTIFICATION_PROMPT_COPY.bannerAction}</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal visible={surface === 'sheet'} animationType="slide" transparent onRequestClose={notNow}>
        <Pressable style={styles.backdrop} onPress={notNow}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.iconCircle}>
              <Bell size={32} />
            </View>
            <Text style={styles.title}>{NOTIFICATION_PROMPT_COPY.title}</Text>
            <Text style={styles.line}>{NOTIFICATION_PROMPT_COPY.line}</Text>
            <Button title={NOTIFICATION_PROMPT_COPY.turnOn} onPress={turnOn} />
            <Pressable accessibilityRole="button" onPress={notNow} style={styles.notNow}>
              <Text style={styles.notNowText}>{NOTIFICATION_PROMPT_COPY.notNow}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 28,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#3A3018',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  line: { color: colors.muted, fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  notNow: { alignItems: 'center', paddingVertical: 14 },
  notNowText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  bannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3A3018',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  bannerText: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  pill: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  pillText: { color: '#111', fontSize: 14, fontWeight: '700' },
});
