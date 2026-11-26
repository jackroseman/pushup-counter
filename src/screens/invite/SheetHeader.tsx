import React from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton, Text } from '../../ui';

/** A sheet's top row: centered title and a close button (invite frames a3 and a6). */
export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.row}>
      <Text variant="headline" align="center" accessibilityRole="header" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.close}>
        <IconButton icon="xmark" accessibilityLabel="Close" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 44, marginTop: 17, justifyContent: 'center' },
  title: { marginHorizontal: 48 },
  close: { position: 'absolute', right: 0, top: 4 },
});
