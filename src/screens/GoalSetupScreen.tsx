import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { calendarDaysBetween, currentTargetLabel, CUSTOM_GOAL, GoalChoice, GoalEnrollment, isoWeekday, PROGRAMS, ProgramId } from '../progress';
import { colors } from '../theme';

export function GoalSetupScreen({
  enrollments,
  today,
  onSave,
  onClose,
}: {
  enrollments: readonly GoalEnrollment[];
  today: string;
  onSave: (choice: GoalChoice) => void;
  onClose: () => void;
}) {
  const open = [...enrollments].reverse().find((e) => e.endedOn === null) ?? null;
  const [programId, setProgramId] = useState<ProgramId | null>(open?.programId ?? null);
  const [custom, setCustom] = useState(open?.customDailyReps ?? CUSTOM_GOAL.suggested);
  const [mode, setMode] = useState<'program' | 'custom' | null>(open?.programId ? 'program' : open?.customDailyReps ? 'custom' : null);
  const [expanded, setExpanded] = useState<ProgramId | null>(null);
  const ready = mode === 'program' ? programId != null : mode === 'custom';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Your goal</Text>
      <Text style={styles.lead}>Follow a program, or set one number for every day.</Text>
      {open ? (
        <Text style={styles.note}>Starting today, this is your goal. Yesterday stays on the old one. Your streak uses the goal that was active that day.</Text>
      ) : null}

      <Text style={styles.section}>Follow a program</Text>
      {PROGRAMS.map((program) => {
        const enrolledHere = open?.programId === program.id;
        const dayNumber = enrolledHere && open ? Math.max(1, calendarDaysBetween(open.startedOn, today) + 1) : 1;
        const selected = mode === 'program' && programId === program.id;
        return (
          <View key={program.id} style={[styles.card, selected && styles.selected]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode('program');
                setProgramId(program.id);
              }}
            >
              <Text style={styles.name}>
                {program.name}
                {enrolledHere ? ' · Current' : ''}
              </Text>
              <Text style={styles.summary}>{program.summary}</Text>
              <Text style={styles.meta}>
                {currentTargetLabel(program, dayNumber)} · {program.lengthLabel}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setExpanded(expanded === program.id ? null : program.id)}>
              <Text style={styles.expand}>{expanded === program.id ? 'Hide the weeks' : 'Show the weeks'}</Text>
            </Pressable>
            {expanded === program.id
              ? program.segments.map((seg, i) => {
                  const rest = seg.restWeekday === 7 ? ' · Sunday off' : '';
                  const marker = seg.setMarker != null ? ` · ${seg.setMarker} in one set` : '';
                  const last = i === program.segments.length - 1;
                  const after = last ? ` · then stays at ${seg.dailyTarget}${seg.restWeekday === 7 ? ', Sunday off' : ', every day'}` : '';
                  return (
                    <Text key={seg.dayFrom} style={styles.week}>
                      Days {seg.dayFrom}–{seg.dayTo} · {seg.dailyTarget} a day{rest}
                      {marker}
                      {after}
                    </Text>
                  );
                })
              : null}
            {selected && program.id === 'first_20' && isoWeekday(today) === 7 ? (
              <Text style={styles.note}>Sunday is a rest day in this program. Today is rest. Monday starts the work.</Text>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.section}>Set my own number</Text>
      <View style={[styles.card, mode === 'custom' && styles.selected]}>
        <Pressable accessibilityRole="button" onPress={() => setMode('custom')}>
          <Text style={styles.name}>
            Same number every day
            {open?.customDailyReps != null ? ' · Current' : ''}
          </Text>
          <Text style={styles.summary}>No rest day. The ring uses this number every day.</Text>
        </Pressable>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lower the daily goal"
            onPress={() => {
              setMode('custom');
              setCustom((n) => Math.max(CUSTOM_GOAL.min, n - CUSTOM_GOAL.step));
            }}
            style={styles.step}
          >
            <Text style={styles.stepLabel}>−</Text>
          </Pressable>
          <Text style={styles.count}>{custom}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Raise the daily goal"
            onPress={() => {
              setMode('custom');
              setCustom((n) => Math.min(CUSTOM_GOAL.max, n + CUSTOM_GOAL.step));
            }}
            style={styles.step}
          >
            <Text style={styles.stepLabel}>+</Text>
          </Pressable>
        </View>
      </View>

      <Button title="Save" disabled={!ready} onPress={() => {
          if (mode === 'program' && programId) onSave({ programId });
          else if (mode === 'custom') onSave({ customDailyReps: custom });
        }}
      />
      {!ready ? <Text style={styles.note}>Pick a program or a number to save.</Text> : null}
      <Button title="Cancel" kind="secondary" onPress={onClose} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 12 },
  lead: { color: colors.muted, fontSize: 16, marginTop: 4, marginBottom: 8 },
  section: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: colors.accent },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  summary: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 20 },
  meta: { color: colors.text, fontSize: 14, marginTop: 8 },
  expand: { color: colors.accent, fontSize: 14, fontWeight: '700', marginTop: 10 },
  week: { color: colors.text, fontSize: 14, marginTop: 6, lineHeight: 20 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  step: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: colors.text, fontSize: 28, fontWeight: '700' },
  count: { color: colors.text, fontSize: 36, fontWeight: '800', marginHorizontal: 24, minWidth: 72, textAlign: 'center' },
});
