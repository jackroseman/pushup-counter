import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { DEFAULT_CONFIG, RepQuality, distanceForRatio } from '../core';
import { colors } from '../theme';

const GRID = '#2A3145';
const LINE = '#5CC8FF';

/** Measures its own width so charts fill the available space. */
function useWidth(initial = 320): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.max(100, Math.round(e.nativeEvent.layout.width)))];
}

export interface DistanceSample {
  t: number;
  d: number | null;
}
export interface RepMarker {
  t: number;
  quality: RepQuality;
  index: number;
}

/** Builds an SVG path, breaking the line where the face wasn't tracked. */
function linePath(points: DistanceSample[], x: (t: number) => number, y: (d: number) => number): string {
  let p = '';
  let pen = false;
  for (const s of points) {
    if (s.d === null) {
      pen = false;
      continue;
    }
    p += `${pen ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.d).toFixed(1)}`;
    pen = true;
  }
  return p;
}

/**
 * Face distance over time (higher = farther from the phone, so the line drops as you go down),
 * with the calibrated top, the Good/Full depth lines and markers where reps were counted.
 */
export function DistanceChart({
  samples,
  tStart,
  tEnd,
  top,
  reps,
  height = 180,
  showRepNumbers = false,
}: {
  samples: DistanceSample[];
  tStart: number;
  tEnd: number;
  top: number | null;
  reps: RepMarker[];
  height?: number;
  showRepNumbers?: boolean;
}) {
  const [width, onLayout] = useWidth();
  const padL = 4;
  const padR = 40;
  const padT = 14;
  const padB = 6;
  const floor = DEFAULT_CONFIG.floorDistance;

  const vals = samples.map((s) => s.d).filter((d): d is number => d !== null);
  let yMax = top !== null ? top + 0.05 : vals.length ? Math.max(...vals) + 0.03 : 0.6;
  let yMin = top !== null ? floor : vals.length ? Math.min(...vals) - 0.03 : 0.1;
  if (vals.length) {
    yMax = Math.max(yMax, Math.max(...vals) + 0.01);
    yMin = Math.min(yMin, Math.min(...vals) - 0.01);
  }
  if (yMax - yMin < 0.05) yMax = yMin + 0.05;
  const span = Math.max(1, tEnd - tStart);
  const x = (t: number) => padL + ((t - tStart) / span) * (width - padL - padR);
  const y = (d: number) => padT + (1 - (d - yMin) / (yMax - yMin)) * (height - padT - padB);

  const lines =
    top !== null
      ? [
          { label: 'Top', d: top, color: colors.muted, dash: undefined },
          { label: 'Good', d: distanceForRatio(top, DEFAULT_CONFIG.goodRatio), color: colors.quality.good, dash: '4,4' },
          { label: 'Full', d: distanceForRatio(top, DEFAULT_CONFIG.fullRatio), color: colors.quality.full, dash: '4,4' },
        ]
      : [];

  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={colors.card} rx={10} />
        {lines.map((l) => (
          <G key={l.label}>
            <Line x1={padL} x2={width - padR} y1={y(l.d)} y2={y(l.d)} stroke={l.color} strokeWidth={1} strokeDasharray={l.dash} opacity={0.8} />
            <SvgText x={width - padR + 4} y={y(l.d) + 4} fill={l.color} fontSize={11}>
              {l.label}
            </SvgText>
          </G>
        ))}
        {reps
          .filter((r) => r.t >= tStart && r.t <= tEnd)
          .map((r) => (
            <G key={r.index}>
              <Line x1={x(r.t)} x2={x(r.t)} y1={padT} y2={height - padB} stroke={colors.quality[r.quality]} strokeWidth={1} opacity={0.5} />
              <Circle cx={x(r.t)} cy={padT - 2} r={4} fill={colors.quality[r.quality]} />
              {showRepNumbers ? (
                <SvgText x={x(r.t) + 5} y={padT + 10} fill={colors.muted} fontSize={10}>
                  {r.index}
                </SvgText>
              ) : null}
            </G>
          ))}
        <Path d={linePath(samples, x, y)} stroke={LINE} strokeWidth={2} fill="none" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** Scrolling live view of the last `windowMs`, redrawn at `fps` from a mutable buffer. */
export function LiveDistanceChart({
  source,
  windowMs,
  fps = 12,
  height = 170,
}: {
  source: { current: { samples: DistanceSample[]; reps: RepMarker[]; top: number | null } };
  windowMs: number;
  fps?: number;
  height?: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), Math.round(1000 / fps));
    return () => clearInterval(id);
  }, [fps]);
  const buf = source.current;
  const now = Date.now();
  const tStart = now - windowMs;
  const samples = buf.samples.filter((s) => s.t >= tStart - 100);
  return (
    <DistanceChart samples={samples} tStart={tStart} tEnd={now} top={buf.top} reps={buf.reps} height={height} />
  );
}

/**
 * Simple per-rep chart: x = rep number, y = value. 'line' draws a connected line with dots
 * (e.g. time between reps), 'bar' draws bars (e.g. depth %). Optional dashed reference lines.
 */
export function RepChart({
  data,
  kind,
  unit,
  height = 170,
  yMin,
  yMax,
  refs = [],
  barColor,
}: {
  data: { rep: number; value: number; color?: string }[];
  kind: 'line' | 'bar';
  unit: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  refs?: { value: number; label: string; color: string }[];
  barColor?: string;
}) {
  const [width, onLayout] = useWidth();
  if (data.length === 0) {
    return (
      <View style={[styles.empty, { height: 60 }]}>
        <Text style={styles.emptyText}>Not enough reps to chart.</Text>
      </View>
    );
  }
  const padL = 34;
  const padR = 40;
  const padT = 12;
  const padB = 22;
  const vals = data.map((d) => d.value);
  const lo = yMin ?? Math.max(0, Math.min(...vals) * 0.8);
  let hi = yMax ?? Math.max(...vals, ...refs.map((r) => r.value)) * 1.15;
  if (hi - lo < 1e-6) hi = lo + 1;
  const n = data.length;
  const plotW = width - padL - padR;
  const slot = plotW / n;
  const x = (i: number) => padL + slot * (i + 0.5);
  const y = (v: number) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (height - padT - padB);
  const labelEvery = Math.max(1, Math.ceil(n / 12));
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const fmt = (v: number) => (hi - lo < 5 ? v.toFixed(1) : Math.round(v).toString());

  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={colors.card} rx={10} />
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <G key={i}>
            <Line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <SvgText x={padL - 4} y={y(v) + 4} fill={colors.muted} fontSize={10} textAnchor="end">
              {fmt(v)}
            </SvgText>
          </G>
        ))}
        {refs.map((r) => (
          <G key={r.label}>
            <Line x1={padL} x2={width - padR} y1={y(r.value)} y2={y(r.value)} stroke={r.color} strokeDasharray="4,4" strokeWidth={1} />
            <SvgText x={width - padR + 4} y={y(r.value) + 4} fill={r.color} fontSize={10}>
              {r.label}
            </SvgText>
          </G>
        ))}
        {kind === 'bar'
          ? data.map((d, i) => (
              <Rect
                key={d.rep}
                x={x(i) - Math.min(14, slot * 0.35)}
                width={Math.min(28, slot * 0.7)}
                y={y(d.value)}
                height={Math.max(1, y(lo) - y(d.value))}
                fill={d.color ?? barColor ?? LINE}
                rx={2}
              />
            ))
          : (
            <G>
              <Path d={path} stroke={LINE} strokeWidth={2} fill="none" strokeLinejoin="round" />
              {data.map((d, i) => (
                <Circle key={d.rep} cx={x(i)} cy={y(d.value)} r={3.5} fill={d.color ?? LINE} />
              ))}
            </G>
          )}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <SvgText key={`l${d.rep}`} x={x(i)} y={height - 6} fill={colors.muted} fontSize={10} textAnchor="middle">
              {d.rep}
            </SvgText>
          ) : null
        )}
        <SvgText x={width - 4} y={height - 6} fill={colors.muted} fontSize={10} textAnchor="end">
          {unit}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: colors.card, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.muted, fontSize: 13 },
});
