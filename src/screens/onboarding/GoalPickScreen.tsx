import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Text } from '../../ui';
import { gutter } from '../../ui/tokens';
import { DEFAULT_PROGRAM } from '../../ui/models/goal';
import { CUSTOM_GOAL, type GoalChoice, type ProgramId } from '../../progress';
import { CustomGoal } from '../goal/CustomGoal';
import { GoalPicker } from '../goal/GoalPicker';
import { OnboardingBar } from './OnboardingBar';

/** Frame 2: step 2 of 3. The middle program is picked; Skip starts without a goal. */
export function GoalPickScreen({
  onBack,
  onSkip,
  onContinue,
  saving,
}: {
  onBack: () => void;
  onSkip: () => void;
  onContinue: (choice: GoalChoice) => void;
  saving?: boolean;
}) {
  const [programId, setProgramId] = useState<ProgramId>(DEFAULT_PROGRAM);
  const [custom, setCustom] = useState<number | null>(null);
  const editing = custom != null;
  return (
    <View style={styles.root}>
      <View style={styles.pad}>
        <OnboardingBar step={2} onBack={editing ? () => setCustom(null) : onBack} onSkip={onSkip} />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
        <Text variant="title1" accessibilityRole="header" style={styles.title}>
          {editing ? 'Set my own number' : 'Pick a daily goal'}
        </Text>
        <Text variant="subhead" style={styles.lead}>
          {editing ? 'The same number every day.' : 'Start small. You can change it any time.'}
        </Text>
        {editing ? (
          <CustomGoal value={custom} onChange={setCustom} />
        ) : (
          <GoalPicker selected={programId} onSelect={setProgramId} onCustom={() => setCustom(CUSTOM_GOAL.suggested)} />
        )}
      </ScrollView>
      <View style={[styles.pad, styles.footer]}>
        <Button
          title="Continue"
          loading={saving}
          onPress={() => onContinue(editing ? { customDailyReps: custom } : { programId })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pad: { paddingHorizontal: gutter },
  title: { marginTop: 14 },
  lead: { marginTop: 6, fontSize: 17, lineHeight: 23 },
  footer: { paddingTop: 8, paddingBottom: 10 },
});
