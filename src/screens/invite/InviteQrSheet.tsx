import React from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text, color, gutter, space } from '../../ui';
import { inviteUrl } from '../../invites/links';
import { SheetHeader } from './SheetHeader';
import { shareInviteLink } from './InviteSheet';

/** Your QR code (invite frame a6): the same link as a big code, with your name under it. */
export function InviteQrSheet({
  code,
  name,
  username,
  onClose,
}: {
  code: string;
  name: string;
  username: string;
  onClose: () => void;
}) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingBottom: Math.max(bottom, space.md) + space.xs }]}>
      <SheetHeader title="Your QR code" onClose={onClose} />
      <View style={styles.tile} accessible accessibilityRole="image" accessibilityLabel="QR code of your invite link">
        <QRCode value={inviteUrl(code)} size={214} color="#000000" backgroundColor="#FFFFFF" quietZone={0} ecl="M" />
      </View>
      <Text variant="title2" align="center" style={styles.name}>
        {name}
      </Text>
      <Text variant="subhead" tone="secondary" align="center" style={styles.handle}>
        {`@${username}`}
      </Text>
      <Text variant="subhead" tone="secondary" align="center" style={styles.hint}>
        Friends can scan this with their iPhone camera.
      </Text>
      <Button title="Share link" icon="share" kind="gray" onPress={() => shareInviteLink(code)} style={styles.share} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.surface, paddingHorizontal: gutter },
  tile: {
    marginTop: 26,
    alignSelf: 'center',
    width: 262,
    height: 262,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: 22 },
  handle: { marginTop: 2 },
  hint: { marginTop: 18, lineHeight: 21 },
  share: { marginTop: 26 },
});
