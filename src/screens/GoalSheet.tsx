import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Button, Card, IconButton, ListGroup, ListRow, Text } from '../ui';
import { color, gutter } from '../ui/tokens';
import { DEFAULT_PROGRAM, goalSummary, openEnrollment } from '../ui/models/goal';
import { CUSTOM_GOAL, type GoalChoice, type GoalEnrollment, type ProgramId } from '../progress';
import { useDiscardGuard } from '../navigation/draft';
import { goalDirty, goalEdited, type GoalDraft } from '../progress/draft';
import { CustomGoal } from './goal/CustomGoal';
import { GoalBars } from './goal/GoalBars';
import { GoalPicker } from './goal/GoalPicker';

type Mode = 'summary' | 'pick' | 'custom';

/** Frame 5: the daily goal sheet. With no goal it opens on the program picker. */
export function GoalSheet({
  enrollments,
  today,
  onSave,
  onClose,
}: {
  enrollments: readonly GoalEnrollment[];
  today: string;
  onSave: (choice: GoalChoice) => Promise<void>;
  onClose: () => void;
}) {
  const summary = goalSummary(enrollments, today);
  const open = openEnrollment(enrollments);
  const [mode, setMode] = useState<Mode>(summary ? 'summary' : 'pick');
  const [programId, setProgramId] = useState<ProgramId>(open?.programId ?? DEFAULT_PROGRAM);
  const [custom, setCustom] = useState(open?.customDailyReps ?? summary?.dailyTarget ?? CUSTOM_GOAL.suggested);
  const [saving, setSaving] = useState(false);
  const draft: GoalChoice = mode === 'custom' ? { customDailyReps: custom } : { programId };
  // A draft only exists while picking; going back to the summary drops it.
  const gd: GoalDraft = 'customDailyReps' in draft ? { kind: 'custom', customDailyReps: draft.customDailyReps } : { kind: 'program', programId: draft.programId };
  const canSave = mode !== 'summary' && goalDirty(open, gd);
  const leave = useDiscardGuard(useNavigation(), mode !== 'summary' && goalEdited(open, gd, DEFAULT_PROGRAM));
  const save = () => {
    setSaving(true);
    void onSave(draft).finally(leave);
  };
  const toSummary = () => {
    setProgramId(open?.programId ?? DEFAULT_PROGRAM);
    setCustom(open?.customDailyReps ?? summary?.dailyTarget ?? CUSTOM_GOAL.suggested);
    setMode('summary');
  };
  const back = summary && mode !== 'summary' ? toSummary : mode === 'custom' ? () => setMode('pick') : null;
  const title = mode === 'custom' ? 'Set my own number' : mode === 'pick' && summary ? 'Change program' : 'Daily goal';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {back ? <IconButton icon="back" accessibilityLabel="Back" onPress={back} /> : null}
        <Text variant="title2" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <IconButton icon="xmark" accessibilityLabel="Close" onPress={onClose} />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {mode === 'summary' && summary ? (
          <>
            <Card padding={16} elevated style={styles.first}>
              <View style={styles.row}>
                <View style={styles.grow}>
                  <Text variant="headline">{summary.title}</Text>
                  <Text variant="footnote" style={styles.gap}>
                    {summary.detail}
                  </Text>
                </View>
                {summary.kind === 'program' ? <GoalBars bars={summary.bars} height={40} width={9} /> : null}
              </View>
            </Card>
            <ListGroup elevated style={styles.group}>
              <ListRow title="Change program" chevron onPress={() => setMode('pick')} />
              <ListRow title="Set my own number" value={String(summary.dailyTarget)} chevron onPress={() => setMode('custom')} />
            </ListGroup>
            <Text variant="caption" style={styles.note}>
              Changes start today.
            </Text>
          </>
        ) : null}
        {mode === 'pick' ? (
          <GoalPicker
            elevated
            selected={programId}
            onSelect={setProgramId}
            customValue={open?.customDailyReps ?? null}
            onCustom={() => setMode('custom')}
          />
        ) : null}
        {mode === 'custom' ? <CustomGoal value={custom} onChange={setCustom} /> : null}
      </ScrollView>
      {mode !== 'summary' ? (
        <View style={styles.footer}>
          <Button title="Save" loading={saving} disabled={!canSave} onPress={save} />
          <Text variant="caption" align="center" style={styles.note}>
            Changes start today.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  header: { height: 44, marginTop: 18, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1 },
  content: { paddingHorizontal: gutter, paddingBottom: 16 },
  first: { marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  grow: { flex: 1, minWidth: 0 },
  gap: { marginTop: 2 },
  group: { marginTop: 12 },
  note: { marginTop: 12, marginHorizontal: 4 },
  footer: { paddingHorizontal: gutter, paddingTop: 8, paddingBottom: 8 },
});
