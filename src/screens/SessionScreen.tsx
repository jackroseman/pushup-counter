import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { LiveDistanceChart } from '../components/charts';
import { LevelView } from '../components/level';
import { FaceCentering } from '../session/FaceCentering';
import { countdownProgress, countingTitle, toBeatLine } from '../session/sessionView';
import { BattleSessionOptions, COUNTDOWN_SECONDS, LIVE_WINDOW_MS, setVoiceOn, useSession } from '../session/useSession';
import { rememberedBattle } from '../battles/battleCache';
import { SessionRecord } from '../storage/history';
import { Settings } from '../storage/settings';
import { Button, Card, Countdown, IconButton, QualityPill, Text, color, gutter, type } from '../ui';

/** Top bar of the set screens: close on the left, a small title, an optional action on the right. */
function SetBar({ title, onClose, right }: { title: string; onClose: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.bar}>
      <IconButton icon="xmark" onPress={onClose} accessibilityLabel="Close" />
      <Text variant="footnote" weight="500" style={styles.barTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {right ?? <View style={styles.barSpacer} />}
    </View>
  );
}

export function SessionScreen({
  settings,
  onFinished,
  onCancel,
  battle,
  setNumber = null,
  onHowItWorks,
}: {
  settings: Settings;
  battle?: BattleSessionOptions;
  /** Which set of the day this is ("Set 4"); null while unknown. */
  setNumber?: number | null;
  onFinished: (record: SessionRecord) => void;
  onCancel: () => void;
  /** The (i) on "Get set": opens How it works (frame 3). No (i) when not given. */
  onHowItWorks?: () => void;
}) {
  const { state, finish, live, recalibrate } = useSession(settings, battle);
  const [voice, setVoice] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const last = state.lastRep;
  const done = useRef(false);
  const end = async () => {
    const record = await finish();
    if (done.current) return;
    done.current = true;
    onFinished(record);
  };
  // Ends by itself: a challenge timer / pause, or the phone stopped lying flat (same path as End set).
  useEffect(() => {
    if (state.autoEnd || state.endedByTilt) end();
  }, [state.autoEnd, state.endedByTilt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set clock for the title ("Set 4 · 0:41"), from "Go".
  const active = state.phase === 'active';
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [active]);

  const infoButton = onHowItWorks ? <IconButton icon="info" onPress={onHowItWorks} accessibilityLabel="How it works" /> : undefined;

  const toggleVoice = () => {
    setVoiceOn(!voice);
    setVoice(!voice);
  };

  /** Closing mid-set throws the set away, so ask once there are reps. */
  const close = () => {
    if (state.count === 0) return onCancel();
    Alert.alert('Discard this set?', "These reps won't be saved.", [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onCancel },
    ]);
  };

  if (state.phase === 'unavailable') {
    return (
      <View style={styles.container}>
        <SetBar title="Get set" onClose={onCancel} />
        <View style={styles.center}>
          <Text variant="title2" align="center">
            Can't count reps
          </Text>
          <Text variant="subhead" align="center" style={styles.sub}>
            {state.status}
          </Text>
        </View>
        <Button title="Close" kind="gray" onPress={onCancel} />
      </View>
    );
  }

  if (state.phase === 'starting' || state.phase === 'placing') {
    return (
      <View style={styles.container}>
        <SetBar title="Get set" onClose={onCancel} right={infoButton} />
        {state.phase === 'placing' ? (
          <View style={styles.levelWrap}>
            <LevelView level={state.level} />
          </View>
        ) : null}
      </View>
    );
  }

  if (state.phase === 'calibrating') {
    return (
      <View style={styles.container}>
        <SetBar title="Get set" onClose={onCancel} right={infoButton} />
        <View style={styles.faceWrap}>
          <FaceCentering guide={state.guide} flatCheck={state.flatCheck} />
        </View>
      </View>
    );
  }

  if (state.phase === 'locked') {
    const n = state.countdown ?? COUNTDOWN_SECONDS;
    return (
      <View style={styles.container}>
        <SetBar title="Get set" onClose={onCancel} />
        <View style={styles.readyWrap}>
          <Countdown value={n} progress={countdownProgress(n, COUNTDOWN_SECONDS)} />
          <Text variant="title2" align="center" style={styles.readyTitle}>
            Ready
          </Text>
          <Text variant="subhead" align="center" style={styles.sub}>
            Keep looking down at your phone.
          </Text>
        </View>
        <Button title="Start over" kind="plain" onPress={recalibrate} />
      </View>
    );
  }

  // Counting (frame 9).
  const toBeat = battle ? toBeatLine(rememberedBattle(battle.battleId), state.count) : null;
  const title = countingTitle({
    setNumber,
    elapsedMs,
    battleClock: state.battleClock,
    isBattle: !!battle,
  });
  return (
    <View style={styles.container}>
      <SetBar
        title={title}
        onClose={close}
        right={<IconButton icon="speaker" onPress={toggleVoice} accessibilityLabel={voice ? 'Mute voice' : 'Unmute voice'} style={!voice && styles.muted} />}
      />
      <View style={styles.center}>
        <Text style={styles.count} accessibilityLabel={`${state.count} reps`} accessibilityLiveRegion="polite">
          {state.count}
        </Text>
        <View style={styles.meta}>
          <Text variant="subhead" tone="secondary" weight="500">
            reps
          </Text>
          {last ? <QualityPill quality={last.quality} /> : null}
          {toBeat ? <Text variant="footnote">· {toBeat}</Text> : null}
        </View>
        <Card style={styles.chartCard}>
          <View style={styles.chartHead}>
            <Text variant="footnote" weight="500">
              Live depth
            </Text>
            <Text variant="caption" tone={state.faceVisible ? 'signal' : 'secondary'}>
              {state.faceVisible ? 'Face centered' : "Can't see your face"}
            </Text>
          </View>
          <View style={styles.chart}>
            <LiveDistanceChart source={live} windowMs={LIVE_WINDOW_MS} fps={12} />
          </View>
        </Card>
      </View>
      {state.phase === 'active' && state.count === 0 ? <Button title="Start over" kind="plain" onPress={recalibrate} /> : null}
      <Button title={battle ? 'Finish attempt' : 'End set'} kind="gray" onPress={end} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: gutter, paddingBottom: 20, backgroundColor: color.bg },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barTitle: { position: 'absolute', left: 56, right: 56, textAlign: 'center' },
  barSpacer: { width: 36 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sub: { marginTop: 8, fontSize: 17, lineHeight: 24, maxWidth: 300 },
  levelWrap: { flex: 1, paddingTop: 90 },
  faceWrap: { flex: 1, paddingTop: 18 },
  readyWrap: { flex: 1, alignItems: 'center', paddingTop: 120 },
  readyTitle: { marginTop: 44 },
  count: { ...type.counter, color: color.label, lineHeight: Math.round(type.counter.fontSize * 0.92) },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  chartCard: { alignSelf: 'stretch', marginTop: 26, paddingTop: 14, paddingBottom: 14 },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chart: { marginTop: 8 },
  muted: { opacity: 0.4 },
});
