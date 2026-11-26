import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, ListGroup, ListRow, Pill, Text, color, gutter, radius, space } from '../../ui';
import { BrandMark } from '../today/BrandMark';
import { INVITE_SHARE_TITLE, inviteLinkLabel, inviteUrl } from '../../invites/links';
import { copyText, lightHaptic } from '../../invites/native';
import { SheetHeader } from './SheetHeader';

export type InviteSheetProps = {
  /** null while it loads. */
  code: string | null;
  error?: string | null;
  onClose: () => void;
  onShowQr: (code: string) => void;
  /** Resolves when the new code is in. */
  onReset: () => Promise<void>;
};

/** Opens the share sheet with the link. Cancelling is not an error. */
export async function shareInviteLink(code: string): Promise<void> {
  const url = inviteUrl(code);
  try {
    await Share.share({ title: INVITE_SHARE_TITLE, message: INVITE_SHARE_TITLE, url }, { subject: INVITE_SHARE_TITLE });
  } catch {
    // The share sheet could not open; there is nothing useful to show.
  }
}

/** Invite friends (invite frames a3, a4, a7): your link, Share link, Copy link, Show QR code, Reset link. */
export function InviteSheet({ code, error, onClose, onShowQr, onReset }: InviteSheetProps) {
  const { bottom } = useSafeAreaInsets();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copied = !!code && copiedCode === code;
  const [resetting, setResetting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    if (!code) return;
    if (await copyText(inviteUrl(code))) {
      lightHaptic();
      setCopiedCode(code);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const reset = () =>
    Alert.alert('Reset your invite link?', 'Your current link will stop working. Friends you already added stay your friends.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          setResetting(true);
          onReset().finally(() => setResetting(false));
        },
      },
    ]);

  return (
    <View style={[styles.root, { paddingBottom: Math.max(bottom, space.md) + space.xs }]}>
      <SheetHeader title="Invite friends" onClose={onClose} />
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <BrandMark size={48} />
          <View style={styles.grow}>
            <Text variant="headline">Your invite link</Text>
            {code && !resetting ? (
              <Text variant="footnote" tone="label" style={styles.link} numberOfLines={1} selectable>
                {inviteLinkLabel(code)}
              </Text>
            ) : error ? (
              <Text variant="footnote" tone="destructive" numberOfLines={2}>
                {error}
              </Text>
            ) : (
              <ActivityIndicator size="small" color={color.secondary} style={styles.spinner} />
            )}
          </View>
        </View>
        <Text variant="footnote" style={styles.cardSub}>
          Anyone with this link can add you as a friend.
        </Text>
      </View>
      <Button title="Share link" icon="share" disabled={!code || resetting} onPress={() => code && shareInviteLink(code)} style={styles.share} />
      <ListGroup elevated style={styles.group}>
        <ListRow
          title="Copy link"
          leading={<Icon name="copy" size={18} color={color.label} />}
          trailing={copied ? <Pill label="Copied" tone="signal" icon="check" /> : undefined}
          onPress={code && !resetting ? copy : undefined}
        />
        <ListRow
          title="Show QR code"
          leading={<Icon name="qr" size={18} color={color.label} />}
          chevron
          onPress={code && !resetting ? () => onShowQr(code) : undefined}
        />
      </ListGroup>
      <Pressable
        onPress={code && !resetting ? reset : undefined}
        accessibilityRole="button"
        style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text variant="subhead" tone="secondary">
          Reset link
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.surface, paddingHorizontal: gutter },
  card: {
    marginTop: 14,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: color.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.separator,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  link: { opacity: 0.85 },
  spinner: { alignSelf: 'flex-start', marginTop: 2 },
  cardSub: { marginTop: space.sm },
  share: { marginTop: 18 },
  group: { marginTop: space.sm },
  reset: { alignSelf: 'center', marginTop: 18, paddingVertical: 2 },
  pressed: { opacity: 0.5 },
});
