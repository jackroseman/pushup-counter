import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { ListGroup, ListRow, SectionHeader, Text, color, gutter } from '../ui';
import { clockLabel } from '../progress/settingsView';
import { TimePill, TimeWheel } from './reminderTime';

const ICON = require('../../assets/icon.png');

/**
 * Daily reminder (frame 30): on/off, the time with the native wheel picker, and a preview of what the
 * reminder says. Only reachable while a daily goal is set (E15).
 */
export function DailyReminderScreen({
  enabled,
  onEnabled,
  time,
  onTime,
  preview,
}: {
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  /** `HH:MM`. */
  time: string;
  onTime: (hhmm: string) => void;
  preview: { title: string; body: string } | null;
}) {
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <ListGroup style={styles.first}>
        <ListRow title="Remind me" switchValue={enabled} onSwitchChange={onEnabled} />
        {enabled ? <ListRow title="Time" trailing={<TimePill value={time} onChange={onTime} accessibilityLabel="Reminder time" />} /> : null}
      </ListGroup>
      {enabled ? <TimeWheel value={time} onChange={onTime} accessibilityLabel="Reminder time" /> : null}
      {enabled && preview ? (
        <>
          <SectionHeader title="Preview" />
          <NotificationPreview title={preview.title} body={preview.body} time={clockLabel(time)} />
        </>
      ) : null}
    </ScrollView>
  );
}

/** Quiet hours: reminders wait until they end. Two times on one wheel (Settings › Quiet hours). */
export function QuietHoursScreen({
  start,
  end,
  onStart,
  onEnd,
}: {
  start: string;
  end: string;
  onStart: (hhmm: string) => void;
  onEnd: (hhmm: string) => void;
}) {
  const [editing, setEditing] = useState<'start' | 'end'>('start');
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <ListGroup style={styles.first}>
        <ListRow
          title="From"
          trailing={<TimePill value={start} onChange={onStart} selected={editing === 'start'} onPress={() => setEditing('start')} accessibilityLabel="Quiet hours from" />}
        />
        <ListRow
          title="To"
          trailing={<TimePill value={end} onChange={onEnd} selected={editing === 'end'} onPress={() => setEditing('end')} accessibilityLabel="Quiet hours to" />}
        />
      </ListGroup>
      <TimeWheel
        key={editing}
        value={editing === 'start' ? start : end}
        onChange={editing === 'start' ? onStart : onEnd}
        accessibilityLabel={editing === 'start' ? 'Quiet hours from' : 'Quiet hours to'}
      />
    </ScrollView>
  );
}

function NotificationPreview({ title, body, time }: { title: string; body: string; time: string }) {
  return (
    <View style={styles.preview} accessible accessibilityLabel={`Preview: ${title}. ${body}`}>
      <Image source={ICON} style={styles.icon} />
      <View style={styles.grow}>
        <View style={styles.previewHead}>
          <Text variant="headline" style={styles.previewTitle}>
            {title}
          </Text>
          <Text variant="caption">{time}</Text>
        </View>
        <Text variant="footnote" tone="label">
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, paddingBottom: 32 },
  first: { marginTop: 16 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: color.elevated,
    borderWidth: 1,
    borderColor: color.separator,
  },
  icon: { width: 38, height: 38, borderRadius: 9 },
  grow: { flex: 1, minWidth: 0 },
  previewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewTitle: { fontSize: 15 },
});
