import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBackend } from '../backend/BackendProvider';
import { useIdentity } from '../backend/IdentityProvider';
import {
  NOTIFICATION_PROMPT_COPY,
  markNotificationBannerDismissed,
  markNotificationPromptShown,
  notificationBannerAction,
  notificationBannerVisible,
  notificationOptInState,
  notificationSurface,
  readNotificationBannerDismiss,
  readNotificationPromptShown,
  subscribeNotificationOptInStorage,
  type BannerDismiss,
} from '../notifications/prompt';
import { Button, Card, Icon, Text, color, radius, space } from '../ui';

function useNotificationOptIn(justActed: boolean) {
  const { session } = useBackend();
  const { push } = useIdentity();
  const [shown, setShown] = useState(false);
  const [dismiss, setDismiss] = useState<BannerDismiss>({ count: 0, at: null });
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const loadGen = useRef(0);
  const load = useCallback(() => {
    const id = ++loadGen.current;
    Promise.all([readNotificationPromptShown(AsyncStorage), readNotificationBannerDismiss(AsyncStorage)]).then(([seen, banner]) => {
      if (id !== loadGen.current) return;
      setShown(seen);
      setDismiss(banner);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    load();
    const off = subscribeNotificationOptInStorage(() => {
      load();
      setNow(Date.now());
    });
    return () => {
      loadGen.current += 1;
      off();
    };
  }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  const available = !!session && ready && push.checked;
  const state = notificationOptInState({ permission: push.permission, shown });
  const sheet = available && notificationSurface({ permission: push.permission, justActed, shown }) === 'sheet';
  const banner =
    available &&
    notificationBannerVisible({
      state,
      dismissCount: dismiss.count,
      lastDismissAt: dismiss.at,
      now,
      sheetOpen: sheet,
    });
  const action = notificationBannerAction(state);

  const answered = () => {
    setShown(true);
    markNotificationPromptShown(AsyncStorage).catch(() => {});
  };
  const turnOnSheet = () => {
    answered();
    void push.enable();
  };
  const enable = () => {
    void push.enable();
  };
  const dismissBanner = () => {
    const at = Date.now();
    setNow(at);
    setDismiss((prev) => ({ count: prev.count + 1, at }));
    markNotificationBannerDismissed(AsyncStorage, at).catch(() => {});
  };

  return { sheet, banner, action, answered, turnOnSheet, enable, dismissBanner };
}

/** The sheet after the first create, accept, or join, including an invite-link join (once). */
export function ChallengeNotifications({ justActed, onConsumed }: { justActed: boolean; onConsumed: () => void }) {
  const insets = useSafeAreaInsets();
  const optIn = useNotificationOptIn(justActed);
  if (!optIn.sheet) return null;

  const notNow = () => {
    optIn.answered();
    onConsumed();
  };
  const turnOn = () => {
    optIn.turnOnSheet();
    onConsumed();
  };

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

/** Soft-nudge on Today and on the challenge screen after Not now or an iOS denial. */
export function NotificationOptInBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const optIn = useNotificationOptIn(false);
  if (!optIn.banner) return null;
  const cta = optIn.action === 'settings' ? NOTIFICATION_PROMPT_COPY.openSettings : NOTIFICATION_PROMPT_COPY.bannerTurnOn;
  return (
    <Card padding={0} style={[styles.banner, style]}>
      <View style={styles.bannerTop}>
        <View style={styles.bannerTile}>
          <Icon name="bell" size={16} color={color.label} />
        </View>
        <View style={styles.bannerCopy}>
          <Text variant="headline" style={styles.bannerTitle}>
            {NOTIFICATION_PROMPT_COPY.title}
          </Text>
          <Text variant="footnote">{NOTIFICATION_PROMPT_COPY.line}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={optIn.dismissBanner} hitSlop={8} style={styles.bannerDismiss}>
          <Icon name="xmark" size={14} color={color.secondary} />
        </Pressable>
      </View>
      <View style={styles.bannerAction}>
        <Button title={cta} kind="tinted" size="small" onPress={optIn.enable} />
      </View>
    </Card>
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
  banner: { padding: 12, paddingLeft: 14, paddingRight: 10 },
  bannerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bannerTile: {
    width: 30,
    height: 30,
    borderRadius: radius.tile,
    backgroundColor: color.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  bannerCopy: { flex: 1, minWidth: 0 },
  bannerTitle: { fontSize: 15, lineHeight: 20 },
  bannerDismiss: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  bannerAction: { alignItems: 'flex-end', marginTop: 10, marginLeft: 40 },
});
