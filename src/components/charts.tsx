import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { DEFAULT_CONFIG, RepQuality, distanceForRatio } from '../core';
import { colors } from '../theme';
import { color } from '../ui/tokens';

const GRID = color.graphite;
const LINE = color.label;

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

/** Lowest point between the previous rep and this one: where the rep's dot sits on the line. */
export function repBottoms(samples: DistanceSample[], reps: RepMarker[], lookbackMs = 2500): { rep: RepMarker; t: number; d: number }[] {
  const out: { rep: RepMarker; t: number; d: number }[] = [];
  let prev = -Infinity;
  for (const rep of reps) {
    const from = Math.max(prev, rep.t - lookbackMs);
    let best: DistanceSample | null = null;
    for (const s of samples) {
      if (s.t < from || s.t > rep.t || s.d === null) continue;
      if (!best || s.d < (best.d as number)) best = s;
    }
    if (best) out.push({ rep, t: best.t, d: best.d as number });
    prev = rep.t;
  }
  return out;
}

const DOT: Record<RepQuality, string> = { full: color.quality.full, good: color.quality.good, shallow: color.quality.shallow };

/**
 * Depth chart (frames 9 and 12): face distance over time, so the line dips as you go down.
 * Dashed Top / Good / Full lines from the calibration, a green band below Full, and a dot at
 * the bottom of each rep (green Full, white Good, graphite Too shallow). No background: it sits
 * inside a Card.
 */
export function DistanceChart({
  samples,
  tStart,
  tEnd,
  top,
  reps,
  height = 122,
  head = false,
}: {
  samples: DistanceSample[];
  tStart: number;
  tEnd: number;
  top: number | null;
  reps: RepMarker[];
  height?: number;
  /** Mark the newest point (live chart). */
  head?: boolean;
}) {
  const [width, onLayout] = useWidth();
  const padR = 34;
  const topY = 20;
  const bandH = 22;
  const fullY = height - 8 - bandH;
  const plotW = Math.max(10, width - padR);

  const vals = samples.map((s) => s.d).filter((d): d is number => d !== null);
  let y: (d: number) => number;
  let lines: { label: string; y: number; stroke: string; text: string; bold?: boolean }[] = [];
  if (top !== null) {
    const full = distanceForRatio(top, DEFAULT_CONFIG.fullRatio);
    const good = distanceForRatio(top, DEFAULT_CONFIG.goodRatio);
    const k = (fullY - topY) / Math.max(1e-6, top - full);
    y = (d: number) => Math.max(2, Math.min(height - 2, topY + (top - d) * k));
    lines = [
      { label: 'Top', y: y(top), stroke: 'rgba(255,255,255,0.12)', text: 'rgba(235,235,245,0.4)' },
      { label: 'Good', y: y(good), stroke: color.separator, text: 'rgba(235,235,245,0.4)' },
      { label: 'Full', y: fullY, stroke: 'rgba(48,209,88,0.45)', text: color.signal, bold: true },
    ];
  } else {
    let hi = vals.length ? Math.max(...vals) + 0.01 : 0.6;
    const lo = vals.length ? Math.min(...vals) - 0.01 : 0.1;
    if (hi - lo < 0.05) hi = lo + 0.05;
    y = (d: number) => topY + ((hi - d) / (hi - lo)) * (height - 8 - topY);
  }
  const span = Math.max(1, tEnd - tStart);
  const x = (t: number) => ((t - tStart) / span) * plotW;
  const dots = repBottoms(samples, reps).filter((b) => b.t >= tStart && b.t <= tEnd);
  let last: DistanceSample | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].d !== null) {
      last = samples[i];
      break;
    }
  }

  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      <Svg width={width} height={height}>
        {top !== null ? <Rect x={0} y={fullY} width={plotW} height={bandH} rx={4} fill="rgba(48,209,88,0.10)" /> : null}
        {lines.map((l) => (
          <G key={l.label}>
            <Line x1={0} x2={plotW} y1={l.y} y2={l.y} stroke={l.stroke} strokeWidth={1} strokeDasharray="3,3" />
            <SvgText x={plotW + 6} y={l.y + 4} fill={l.text} fontSize={10} fontWeight={l.bold ? '600' : '400'}>
              {l.label}
            </SvgText>
          </G>
        ))}
        <Path d={linePath(samples, x, y)} stroke={LINE} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {dots.map((b) => (
          <Circle
            key={b.rep.index}
            cx={x(b.t)}
            cy={y(b.d)}
            r={3.5}
            fill={DOT[b.rep.quality]}
            stroke={b.rep.quality === 'shallow' ? color.tertiary : undefined}
            strokeWidth={b.rep.quality === 'shallow' ? 1 : 0}
          />
        ))}
        {head && last && last.d !== null ? <Circle cx={x(last.t)} cy={y(last.d)} r={4.5} fill={color.signal} /> : null}
      </Svg>
    </View>
  );
}

/** Scrolling live view of the last `windowMs`, redrawn at `fps` from a mutable buffer. */
export function LiveDistanceChart({
  source,
  windowMs,
  fps = 12,
  height = 122,
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
    <DistanceChart samples={samples} tStart={tStart} tEnd={now} top={buf.top} reps={buf.reps} height={height} head />
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
