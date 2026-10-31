import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Stat } from '../components/ui';
import { DistanceChart, RepChart } from '../components/charts';
import { analyzeSet, qualityLabel, tempoTrendLabel, SetAnalysis } from '../core';
import { SessionRecord } from '../storage/history';
import { colors } from '../theme';

const sec = (v: number | null, digits = 1) => (v === null ? '—' : `${v.toFixed(digits)} s`);

function clock(totalSec: number): string {
  const s = Math.round(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Plain-language takeaways from the analysis. */
export function insights(a: SetAnalysis): string[] {
  const out: string[] = [];
  if (a.tempo) {
    if (a.tempo.trend === 'slowing')
      out.push(
        `Your reps slowed from ${a.tempo.firstThirdSec.toFixed(1)} s to ${a.tempo.lastThirdSec.toFixed(1)} s apart in the last third of the set (+${a.tempo.changePct}%), a sign of fatigue.`
      );
    else if (a.tempo.trend === 'speeding-up')
      out.push(`You sped up toward the end (${a.tempo.firstThirdSec.toFixed(1)} s → ${a.tempo.lastThirdSec.toFixed(1)} s between reps).`);
    else out.push(`You kept a steady pace of about ${a.avgIntervalSec?.toFixed(1)} s per rep.`);
  }
  if (a.depthChangePct !== null && a.depthChangePct <= -10)
    out.push(`Depth dropped ${Math.abs(a.depthChangePct)} points in the last third. Watch your range when you get tired.`);
  if (a.depthConsistency === 'variable') out.push('Your depth varied a lot from rep to rep. Aim for the same bottom position every time.');
  if (a.avgDescentSec !== null && a.avgAscentSec !== null && a.avgDescentSec < 0.6)
    out.push('Your descents were quick. Lowering more slowly builds more strength and control.');
  return out;
}

export function SummaryScreen({
  record,
  onDone,
  fromHistory,
}: {
  record: SessionRecord;
  onDone: () => void;
  fromHistory?: boolean;
}) {
  const a = useMemo(() => analyzeSet(record.reps, record.startedAt, record.endedAt), [record]);
  const tips = insights(a);

  const traceSamples = useMemo(
    () => (record.trace ?? []).map(([t, d]) => ({ t: record.startedAt + t, d })),
    [record]
  );
  const markers = record.reps.map((r) => ({ t: r.timestamp, quality: r.quality, index: r.index }));
  const traceEnd = traceSamples.length ? traceSamples[traceSamples.length - 1].t : record.endedAt;
  const qualityOf = new Map(record.reps.map((r) => [r.index, r.quality]));

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        <Text style={styles.title}>{fromHistory ? 'Set analysis' : 'Set complete'}</Text>
        <Text style={styles.date}>{new Date(record.startedAt).toLocaleString()}</Text>

        <View style={styles.row}>
          <Stat label="Reps" value={String(a.totalReps)} />
          <Stat label="Set time" value={clock(a.durationSec)} />
          <Stat label="Reps / min" value={a.repsPerMinute === null ? '—' : a.repsPerMinute.toFixed(0)} />
        </View>
        <View style={styles.row}>
          <Stat label="Avg between reps" value={sec(a.avgIntervalSec)} />
          <Stat label="Median between reps" value={sec(a.medianIntervalSec)} />
        </View>
        <View style={styles.row}>
          <Stat
            label="Tempo trend (last vs first third)"
            value={tempoTrendLabel(a.tempo)}
            small
            color={a.tempo?.trend === 'slowing' ? colors.quality.good : undefined}
          />
        </View>
        <View style={styles.row}>
          <Stat label="Avg depth" value={a.avgDepthPct === null ? '—' : `${a.avgDepthPct}%`} />
          <Stat
            label="Depth consistency"
            value={a.depthConsistency === null ? '—' : `±${a.depthStdPct?.toFixed(0)}%`}
          />
        </View>
        {a.depthConsistency ? <Text style={styles.caption}>Depth was {a.depthConsistency} across reps.</Text> : null}
        <View style={styles.row}>
          <Stat label="Full" value={String(a.fullReps)} color={colors.quality.full} />
          <Stat label="Good" value={String(a.goodReps)} color={colors.quality.good} />
          <Stat label="Shallow" value={String(a.shallowReps)} color={colors.quality.shallow} />
        </View>
        <View style={styles.row}>
          <Stat label="Avg down" value={sec(a.avgDescentSec)} />
          <Stat label="Avg up" value={sec(a.avgAscentSec)} />
        </View>
        <View style={styles.row}>
          <Stat label="Fastest rep" value={a.fastestRep ? `#${a.fastestRep.rep} · ${a.fastestRep.value.toFixed(1)}s` : '—'} small />
          <Stat label="Slowest rep" value={a.slowestRep ? `#${a.slowestRep.rep} · ${a.slowestRep.value.toFixed(1)}s` : '—'} small />
        </View>

        {tips.length ? (
          <View style={styles.card}>
            {tips.map((t, i) => (
              <Text key={i} style={styles.tip}>
                • {t}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.section}>Time between reps</Text>
        <Text style={styles.caption}>Seconds from one rep to the next. A rising line means you're slowing down.</Text>
        <RepChart
          kind="line"
          unit="rep #"
          yMin={0}
          data={a.intervals}
          refs={a.avgIntervalSec !== null ? [{ value: a.avgIntervalSec, label: 'avg', color: colors.muted }] : []}
        />

        <Text style={styles.section}>Depth per rep</Text>
        <RepChart
          kind="bar"
          unit="rep #"
          yMin={0}
          yMax={100}
          data={a.depthPcts.map((d) => ({ ...d, color: colors.quality[d.quality] }))}
          refs={[
            { value: 70, label: 'Full', color: colors.quality.full },
            { value: 45, label: 'Good', color: colors.quality.good },
          ]}
        />

        <Text style={styles.section}>Face distance over the set</Text>
        {traceSamples.length ? (
          <DistanceChart
            samples={traceSamples}
            tStart={record.startedAt}
            tEnd={Math.max(traceEnd, markers.length ? markers[markers.length - 1].t : 0)}
            top={record.calibratedTopDistance}
            reps={markers}
            height={200}
            showRepNumbers={markers.length <= 30}
          />
        ) : (
          <Text style={styles.caption}>No distance trace was saved for this set (recorded with an older version).</Text>
        )}

        <Text style={styles.section}>Reps</Text>
        <View style={styles.repHeader}>
          <Text style={[styles.cell, styles.cIdx]}>#</Text>
          <Text style={[styles.cell, styles.cQual]}>Quality</Text>
          <Text style={[styles.cell, styles.cNum]}>Depth</Text>
          <Text style={[styles.cell, styles.cNum]}>Down</Text>
          <Text style={[styles.cell, styles.cNum]}>Up</Text>
          <Text style={[styles.cell, styles.cNum]}>Gap</Text>
        </View>
        {record.reps.map((r, i) => {
          const gap = r.intervalMs ?? (i > 0 ? r.timestamp - record.reps[i - 1].timestamp : null);
          return (
            <View key={r.index} style={styles.repRow}>
              <Text style={[styles.cell, styles.cIdx]}>{r.index}</Text>
              <Text style={[styles.cell, styles.cQual, { color: colors.quality[qualityOf.get(r.index) ?? r.quality], fontWeight: '700' }]}>
                {qualityLabel(r.quality)}
              </Text>
              <Text style={[styles.cell, styles.cNum]}>{r.depthRatio !== null ? `${Math.round(r.depthRatio * 100)}%` : '—'}</Text>
              <Text style={[styles.cell, styles.cNum]}>{r.descentMs != null ? (r.descentMs / 1000).toFixed(1) : '—'}</Text>
              <Text style={[styles.cell, styles.cNum]}>{r.ascentMs != null ? (r.ascentMs / 1000).toFixed(1) : '—'}</Text>
              <Text style={[styles.cell, styles.cNum]}>{gap != null ? (gap / 1000).toFixed(1) : '—'}</Text>
            </View>
          );
        })}
        <Text style={styles.caption}>Down/Up/Gap in seconds. Gap = time since the previous rep.</Text>
      </ScrollView>
      <Button title="Done" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  date: { color: colors.muted, fontSize: 14, marginBottom: 12 },
  row: { flexDirection: 'row', marginHorizontal: -4 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginTop: 8 },
  tip: { color: colors.text, fontSize: 15, lineHeight: 21, marginVertical: 2 },
  section: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 22, marginBottom: 6 },
  caption: { color: colors.muted, fontSize: 13, marginVertical: 6 },
  repHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3145' },
  repRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3145' },
  cell: { color: colors.muted, fontSize: 14, fontVariant: ['tabular-nums'] },
  cIdx: { width: 34 },
  cQual: { width: 74 },
  cNum: { flex: 1, textAlign: 'right' },
});
