import { Host, Picker } from '@expo/ui';
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

export type MenuPickerOption<K extends string> = { key: K; label: string };

/** Native pull-down menu (SwiftUI `Picker` with menu style — a `UIMenu` on iOS). */
export function MenuPicker<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: {
  options: readonly MenuPickerOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (!options.length) return null;
  return (
    <Host matchContents colorScheme="dark" ignoreSafeArea="all" style={style}>
      <Picker
        selectedValue={value}
        onValueChange={onChange}
        appearance="menu"
        accessibilityLabel={accessibilityLabel}
      >
        {options.map((o) => (
          <Picker.Item key={o.key} label={o.label} value={o.key} />
        ))}
      </Picker>
    </Host>
  );
}
