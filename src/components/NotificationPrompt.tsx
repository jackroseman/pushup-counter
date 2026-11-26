import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import { NOTIFICATION_PROMPT_COPY, markNotificationPromptShown, notificationSurface, readNotificationPromptShown } from '../notifications/prompt';
import { Button, Icon, Text, color, radius, space } from '../ui';

/** The sheet after the first create, accept, or join (frame 22), shown once. No banner anywhere. */
export function ChallengeNotifications({ justActed, onConsumed }: { justActed: boolean; onConsumed: () => void }) {
  const { session } = useBackend();
  const { push } = useIdentity();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    readNotificationPromptShown(AsyncStorage).then((seen) => {
      if (!alive) return;
      setShown(seen);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!session || !ready || !push.checked) return null;
  const surface = notificationSurface({ permission: push.permission, justActed, shown });
  if (surface !== 'sheet') return null;

  const answered = () => {
    setShown(true);
    onConsumed();
    markNotificationPromptShown(AsyncStorage).catch(() => {});
  };
  const turnOn = () => {
    answered();
    void push.enable();
  };
  const notNow = answered;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={notNow}>
      <Pressable style={styles.backdrop} onPress={notNow} accessibilityLabel={NOTIFICATION_PROMPT_COPY.notNow}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.md) }]} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.tile}>
            <Icon name="bell" size={30} color={color.label} />
          </View>
          <Text variant="title2" align="center" style={styles.title}>
            {NOTIFICATION_PROMPT_COPY.title}
          </Text>
          <Text variant="body" tone="secondary" align="center" style={styles.line}>
            {NOTIFICATION_PROMPT_COPY.line}
          </Text>
          <View style={styles.actions}>
            <Button title={NOTIFICATION_PROMPT_COPY.turnOn} onPress={turnOn} />
            <Button title={NOTIFICATION_PROMPT_COPY.notNow} kind="plain" onPress={notNow} style={styles.notNow} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: color.fill.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.separator,
    paddingHorizontal: space.xl,
  },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.fill.grabber, alignSelf: 'center', marginTop: 6 },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: color.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 28,
  },
  title: { marginTop: 18 },
  line: { marginTop: space.xs, lineHeight: 23 },
  actions: { marginTop: 26 },
  notNow: { marginTop: 2 },
});
