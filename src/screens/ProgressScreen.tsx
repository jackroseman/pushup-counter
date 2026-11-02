import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RepSeriesChart } from '../components/progressChart';
import { Button } from '../components/ui';
import {
  EMPTY_PROGRESS,
  MILESTONES,
  STREAK_NOW,
  formatCount,
  lockedBadgeText,
} from '../progress';
import type { ProgressModel, ShelfRecord } from '../progress';
import { colors } from '../theme';

const RANGES = ['Day', 'Week', 'Month', 'Lifetime'] as const;
type Range = (typeof RANGES)[number];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${SHORT_MONTHS[month - 1]} ${day}`;
}

function monthLabel(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function windowTotal(view: ProgressModel, range: Range): number {
  if (range === 'Day') return view.day.reduce((sum, bucket) => sum + bucket.reps, 0);
  if (range === 'Week') return view.week.reduce((sum, bucket) => sum + bucket.reps, 0);
  if (range === 'Month') return view.month.reduce((sum, bucket) => sum + bucket.reps, 0);
  return view.lifetime[view.lifetime.length - 1]?.total ?? 0;
}

function rangeCaption(view: ProgressModel, range: Range): string {
  if (view.empty) return EMPTY_PROGRESS;
  if (range === 'Day') return `${shortDate(view.day[0].date)} – ${shortDate(view.day[view.day.length - 1].date)}`;
  if (range === 'Week') return 'Last 12 weeks';
  if (range === 'Month') return 'Last 12 months';
  return 'Running total';
}

function recordDate(label: string, record: ShelfRecord): string {
  if (label === 'Best week') return `Week of ${shortDate(record.date)}`;
  if (label === 'Best month') return monthLabel(record.date);
  return shortDate(record.date);
}

export function ProgressScreen({
  view,
  onBack,
  onAllSets,
  onProgram,
}: {
  view: ProgressModel;
  onBack: () => void;
  onAllSets: () => void;
  onProgram: () => void;
}) {
  const [range, setRange] = useState<Range>('Day');
  const values =
    range === 'Day'
      ? view.day.map((bucket) => bucket.reps)
      : range === 'Week'
        ? view.week.map((bucket) => bucket.reps)
        : range === 'Month'
          ? view.month.map((bucket) => bucket.reps)
          : view.lifetime.map((point) => point.total);
  const showTarget = range === 'Day' && view.day.some((bucket) => bucket.target != null && bucket.target > 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Progress</Text>

      <View style={styles.switch}>
        {RANGES.map((name) => {
          const selected = name === range;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setRange(name)}
              style={[styles.switchItem, selected && styles.switchOn]}
            >
              <Text style={[styles.switchLabel, selected && styles.switchLabelOn]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chartCard}>
        <Text style={styles.total}>{formatCount(windowTotal(view, range))}</Text>
        <Text style={styles.caption}>{rangeCaption(view, range)}</Text>
        {view.empty ? (
          <View style={styles.emptyChart} />
        ) : (
          <RepSeriesChart
            mode={range === 'Lifetime' ? 'line' : 'bar'}
            values={values}
            marks={range === 'Day' ? view.day.map((bucket) => bucket.target) : undefined}
            guides={range === 'Lifetime' ? MILESTONES : undefined}
          />
        )}
        {!view.empty && range === 'Lifetime' ? <Text style={styles.note}>Each point is a week, oldest on the left.</Text> : null}
        {!view.empty && range !== 'Lifetime' ? (
          <Text style={styles.note}>
            {range === 'Day' ? 'Oldest on the left. Today is on the right.' : `Oldest ${range.toLowerCase()} on the left. This ${range.toLowerCase()} is on the right.`}
          </Text>
        ) : null}
        {showTarget ? <Text style={styles.note}>The mark on a bar is that day's target.</Text> : null}
        {view.historyNote ? <Text style={styles.note}>{view.historyNote}</Text> : null}
      </View>

      <Text style={styles.section}>Records</Text>
      <View style={styles.card}>
        {(
          [
            ['Best set', view.bestSet],
            ['Best day', view.bestDay],
            ['Best week', view.bestWeek],
            ['Best month', view.bestMonth],
          ] as const
        ).map(([label, record]) => (
          <ShelfRow key={label} label={label} value={record ? formatCount(record.reps) : '—'} detail={record ? recordDate(label, record) : null} />
        ))}
        <ShelfRow
          label="Longest streak"
          value={view.longestStreak > 0 ? `${view.longestStreak} ${view.longestStreak === 1 ? 'day' : 'days'}` : '—'}
          detail={view.streakIsNow ? STREAK_NOW : null}
        />
      </View>

      <Text style={styles.section}>Milestones</Text>
      <View style={styles.badges}>
        {view.badges.map((badge) => (
          <View key={badge.milestone} style={[styles.badge, badge.earnedOn ? styles.badgeOn : null]}>
            <Text style={styles.badgeValue}>{formatCount(badge.milestone)}</Text>
            <Text style={styles.badgeCaption}>
              {badge.earnedOn ? shortDate(badge.earnedOn) : lockedBadgeText(badge.remaining ?? badge.milestone, badge.milestone)}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Program</Text>
      <Pressable accessibilityRole="button" onPress={onProgram} style={({ pressed }) => [styles.card, styles.program, pressed && { opacity: 0.75 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.programName}>{view.program.name}</Text>
          <Text style={styles.programDetail}>{view.program.detail}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Button title="All sets" kind="secondary" onPress={onAllSets} />
      <Button title="Back" onPress={onBack} />
    </ScrollView>
  );
}

function ShelfRow({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <View style={styles.shelfRow}>
      <Text style={styles.shelfLabel}>{label}</Text>
      <View style={styles.shelfValues}>
        <Text style={styles.shelfValue}>{value}</Text>
        {detail ? <Text style={styles.shelfDetail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 12 },
  switch: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 4, marginTop: 16 },
  switchItem: { flex: 1, borderRadius: 9, paddingVertical: 8, alignItems: 'center' },
  switchOn: { backgroundColor: colors.accent },
  switchLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  switchLabelOn: { color: '#111' },
  chartCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginTop: 12 },
  total: { color: colors.text, fontSize: 32, fontWeight: '800' },
  caption: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  emptyChart: { height: 120 },
  note: { color: colors.muted, fontSize: 13, marginTop: 8, lineHeight: 18 },
  section: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4 },
  shelfRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  shelfLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  shelfValues: { alignItems: 'flex-end' },
  shelfValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  shelfDetail: { color: colors.muted, fontSize: 13, marginTop: 2 },
  badges: { flexDirection: 'row', gap: 8 },
  badge: { flex: 1, backgroundColor: colors.card, borderRadius: 14, padding: 12, minHeight: 84 },
  badgeOn: { backgroundColor: '#24301C' },
  badgeValue: { color: colors.text, fontSize: 16, fontWeight: '800' },
  badgeCaption: { color: colors.muted, fontSize: 12, marginTop: 6, lineHeight: 16 },
  program: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  programName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  programDetail: { color: colors.muted, fontSize: 14, marginTop: 4 },
  chevron: { color: colors.muted, fontSize: 28, fontWeight: '300', marginLeft: 8 },
});
