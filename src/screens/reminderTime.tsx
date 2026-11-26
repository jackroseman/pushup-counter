import React from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { Card, Text, color, radius } from '../ui';
import { clockLabel, clockToDate, dateToClock } from '../progress/settingsView';

/** The native iOS wheel time picker in a card (frame 30). Android uses the system dialog from the time pill. */
export function TimeWheel({ value, onChange, accessibilityLabel }: { value: string; onChange: (hhmm: string) => void; accessibilityLabel: string }) {
  if (Platform.OS !== 'ios') return null;
  return (
    <Card padding={0} style={styles.wheel}>
      <DateTimePicker
        value={clockToDate(value)}
        mode="time"
        display="spinner"
        minuteInterval={5}
        themeVariant="dark"
        textColor={color.label}
        accessibilityLabel={accessibilityLabel}
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'set' && date) onChange(dateToClock(date));
        }}
        style={styles.picker}
      />
    </Card>
  );
}

/** Time capsule on the right of a row (`6:00 PM`). On Android it opens the system time dialog. */
export function TimePill({
  value,
  onChange,
  selected = true,
  onPress,
  accessibilityLabel,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  const press = () => {
    onPress?.();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: clockToDate(value),
        mode: 'time',
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(dateToClock(date));
        },
      });
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}, ${clockLabel(value)}`}
      accessibilityState={{ selected }}
      onPress={press}
      hitSlop={6}
      style={[styles.pill, selected ? styles.pillOn : styles.pillOff]}
    >
      <Text variant="body" weight="600" tabular style={styles.pillText}>
        {clockLabel(value)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wheel: { marginTop: 10, overflow: 'hidden', alignItems: 'center' },
  picker: { height: 216, alignSelf: 'stretch' },
  pill: { height: 32, paddingHorizontal: 12, borderRadius: radius.capsule, justifyContent: 'center' },
  pillOn: { backgroundColor: color.graphite },
  pillOff: { backgroundColor: color.fill.pill },
  pillText: { fontSize: 16 },
});

