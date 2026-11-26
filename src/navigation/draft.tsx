import React, { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { usePreventRemove, type NavigationProp, type ParamListBase } from '@react-navigation/native';

import { Text } from '../ui';

type Nav = Pick<NavigationProp<ParamListBase>, 'goBack' | 'setOptions' | 'dispatch'>;

/**
 * Leaving an edit screen with unsaved changes (back button, swipe back, sheet drag) asks
 * "Discard changes?". Returns `leave()`: call it after a successful save to go back without asking.
 */
export function useDiscardGuard(navigation: Nav, dirty: boolean): () => void {
  const [leaving, setLeaving] = useState(false);
  usePreventRemove(dirty && !leaving, ({ data }) => {
    Alert.alert('Discard changes?', "Your changes won't be saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    if (leaving) navigation.goBack();
  }, [leaving, navigation]);
  return () => setLeaving(true);
}

/** The iOS-standard Save button on the right of the native header: disabled until something changed. */
export function useSaveHeader(navigation: Nav, { canSave, saving, onSave }: { canSave: boolean; saving?: boolean; onSave: () => void }): void {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        saving ? (
          <ActivityIndicator accessibilityLabel="Saving" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={onSave}
            hitSlop={10}
            style={styles.save}
          >
            <Text variant="headline" tone={canSave ? 'label' : 'tertiary'}>
              Save
            </Text>
          </Pressable>
        ),
    });
  }, [navigation, canSave, saving, onSave]);
}

const styles = StyleSheet.create({ save: { paddingHorizontal: 4 } });
