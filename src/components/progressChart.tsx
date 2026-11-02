import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { chartCeiling } from '../progress';
import { colors } from '../theme';

function useWidth(initial = 320): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(initial);
  return [width, (event) => setWidth(Math.max(100, Math.round(event.nativeEvent.layout.width)))];
}

function guideLabel(value: number): string {
  return value >= 1000 && value % 1000 === 0 ? `${value / 1000}k` : String(value);
}

/** Bars for a window of counted reps, or the lifetime running total. */
export function RepSeriesChart({
  mode,
  values,
  marks,
  guides = [],
  height = 168,
}: {
  mode: 'bar' | 'line';
  values: number[];
  /** Per-bar target. A mark is drawn only when the target is above zero. */
  marks?: readonly (number | null)[];
  guides?: readonly number[];
  height?: number;
}) {
  const [width, onLayout] = useWidth();
  if (values.length === 0) return <View onLayout={onLayout} style={{ height }} />;

  const markPeak = (marks ?? []).reduce<number>((peak, value) => (value != null && value > peak ? value : peak), 0);
  const peak = values.reduce((peak, value) => Math.max(peak, value), markPeak);
  const ceiling = chartCeiling(peak, guides);
  const padL = 8;
  const padR = guides.length ? 36 : 8;
  const padT = 14;
  const padB = 8;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);
  const y = (value: number) => padT + (1 - value / ceiling) * plotH;
  const n = values.length;

  const bars = values.map((value, index) => {
    const slot = plotW / n;
    const barW = Math.max(2, slot * 0.62);
    const x = padL + index * slot + (slot - barW) / 2;
    const barH = (value / ceiling) * plotH;
    const mark = marks?.[index];
    return (
      <G key={index}>
        {value > 0 ? <Rect x={x} y={y(value)} width={barW} height={Math.max(2, barH)} rx={3} fill={colors.accent} /> : null}
        {mark != null && mark > 0 ? <Line x1={x} x2={x + barW} y1={y(mark)} y2={y(mark)} stroke={colors.text} strokeWidth={2} /> : null}
      </G>
    );
  });

  const xs = values.map((_, index) => padL + ((index + 0.5) / n) * plotW);
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xs[index].toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;

  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="#2A3145" strokeWidth={1} />
        {guides.map((guide) =>
          guide <= ceiling ? (
            <G key={guide}>
              <Line x1={padL} x2={width - padR} y1={y(guide)} y2={y(guide)} stroke="#2A3145" strokeDasharray="4 4" strokeWidth={1} />
              <SvgText x={width - 2} y={y(guide) + 3} fill={colors.muted} fontSize={10} textAnchor="end">
                {guideLabel(guide)}
              </SvgText>
            </G>
          ) : null,
        )}
        {mode === 'bar' ? (
          bars
        ) : (
          <G>
            <Path d={path} stroke={colors.accent} strokeWidth={2.5} fill="none" />
            <Circle cx={xs[last]} cy={y(values[last])} r={4} fill={colors.accent} />
          </G>
        )}
      </Svg>
    </View>
  );
}
