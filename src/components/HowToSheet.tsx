import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { HOW_COUNTING_WORKS } from '../progress/howto';
import { colors } from '../theme';

export function HowToSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>How counting works</Text>
          <ScrollView>
            {HOW_COUNTING_WORKS.map((step, i) => (
              <View key={i} style={styles.step}>
                <Text style={styles.num}>{i + 1}</Text>
                <Text style={styles.text}>{step}</Text>
              </View>
            ))}
          </ScrollView>
          <Button title="Got it" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  step: { flexDirection: 'row', marginBottom: 10 },
  num: { color: colors.accent, fontWeight: '800', fontSize: 16, width: 22 },
  text: { color: colors.text, fontSize: 15, flex: 1, lineHeight: 21 },
});
