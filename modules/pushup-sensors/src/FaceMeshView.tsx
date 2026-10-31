import * as React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { requireNativeView } from 'expo';

import { FaceMeshViewProps } from './PushupSensors.types';

let NativeView: React.ComponentType<FaceMeshViewProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    NativeView = requireNativeView<FaceMeshViewProps>('PushupSensors');
  } catch {
    NativeView = null; // e.g. Expo Go / a build without the native module
  }
}

/**
 * Live ARKit face mesh + measurements, rendered natively from the module's existing face
 * tracking session (it never starts its own camera). iOS only; elsewhere shows a placeholder.
 */
export function FaceMeshView(props: FaceMeshViewProps) {
  if (!NativeView) {
    return (
      <View style={[styles.placeholder, props.style]}>
        <Text style={styles.text}>Face view needs an iPhone with Face ID.</Text>
      </View>
    );
  }
  return <NativeView {...props} />;
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: '#0B0F1A', borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 16 },
  text: { color: '#8A93A8', fontSize: 14, textAlign: 'center' },
});
