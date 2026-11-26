import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { DEFAULT_CONFIG, RepQuality, distanceForRatio } from '../core';
import { color } from '../ui/tokens';

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

/** Smooth path through points (Catmull-Rom as cubic Béziers). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Moving average so the curve shows the trend, not every rep. */
function smooth(values: readonly number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const part = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
    return part.reduce((a, b) => a + b, 0) / part.length;
  });
}

/**
 * Pace over the set (Set details, frame 12): one smooth white line, higher = quicker, no axes
 * or per-rep marks. Needs at least two points.
 */
export function PaceCurve({ values, height = 64 }: { values: readonly number[]; height?: number }) {
  const [width, onLayout] = useWidth();
  if (values.length < 2) return null;
  const v = smooth(values, Math.max(1, Math.round(values.length / 6)));
  const hi = Math.max(...v);
  const lo = Math.min(...v);
  const range = Math.max(hi - lo, hi * 0.15, 1e-6);
  const mid = (hi + lo) / 2;
  const pad = 6;
  const pts = v.map((val, i) => ({
    x: (i / (v.length - 1)) * (width - 12),
    y: pad + (1 - ((val - mid) / range + 0.5)) * (height - pad * 2),
  }));
  return (
    <View onLayout={onLayout} style={{ width: '100%', height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Path d={smoothPath(pts)} stroke={LINE} strokeWidth={2} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}
