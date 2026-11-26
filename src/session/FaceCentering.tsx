import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FaceMeshView } from '../../modules/pushup-sensors';
import type { GuideSnapshot } from '../core';
import { faceMeshVariantSupported } from '../sensors';
import { Pill, ProgressBar, Text, color, radius } from '../ui';
import { type FaceDiag, faceCenteringView, faceDiagLine, isDevVariant } from './sessionView';
import { devSkipMotionOn, setDevSkipMotion } from './useSession';

const DEV_VARIANT = isDevVariant(Constants.expoConfig, __DEV__);

/** Corner brackets around the face (frame 7): green once the pose is right. */
function Brackets({ ok }: { ok: boolean }) {
  const stroke = ok ? color.signal : color.secondary;
  return (
    <Svg width={124} height={152} viewBox="0 0 124 152" style={styles.brackets} pointerEvents="none">
      <Path
        d="M2 20 V2 H20 M104 2 H122 V20 M2 132 V150 H20 M104 150 H122 V132"
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * "Center your face" (frame 7): the live face view in a card with Phone flat / Centered pills,
 * then the title, one plain line and the hold-still progress bar. Logic stays in CalibrationGuide.
 */
export function FaceCentering({
  guide,
  flatCheck,
  diag,
  status,
  onStopMotion,
}: {
  guide: GuideSnapshot | null;
  flatCheck: boolean;
  /** Dev-only diagnostics (Pushup Dev); remove in PR 15. */
  diag?: React.RefObject<FaceDiag>;
  status?: string;
  onStopMotion?: () => void;
}) {
  const v = faceCenteringView(guide);
  const variantOk = faceMeshVariantSupported();
  // Dev only: tap the diagnostics line to switch to the original "full" view, whose native
  // labels show the camera state ("Camera starting" = no frames, "Face lost" = frames, no face).
  const [full, setFull] = useState(false);
  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
  const [now, setNow] = useState(0);
  const [skipNext, setSkipNext] = useState(devSkipMotionOn());
  const showDiag = DEV_VARIANT && !!diag;
  useEffect(() => {
    if (!showDiag) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [showDiag]);
  const minimal = variantOk && !full;
  const onLayout = showDiag
    ? (e: LayoutChangeEvent) => setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
    : undefined;
  return (
    <View>
      <View style={styles.card} onLayout={onLayout}>
        <FaceMeshView style={StyleSheet.absoluteFill} showAngles={full} {...(variantOk ? { variant: minimal ? ('minimal' as const) : ('full' as const) } : null)} />
        <Brackets ok={v.ready} />
        {full ? null : (
          <>
            {flatCheck ? <Pill label="Phone flat" tone="signal" icon="check" style={styles.pillLeft} /> : null}
            <Pill label={v.centered ? 'Centered' : 'Not centered'} tone={v.centered ? 'signal' : 'neutral'} style={styles.pillRight} />
          </>
        )}
      </View>
      {showDiag && diag?.current ? (
        <Pressable onPress={() => setFull((f) => !f)} accessibilityRole="button" accessibilityLabel="Diagnostics">
          <Text variant="caption" tone="secondary" align="center" style={styles.diag}>
            {`DEV ${faceDiagLine(diag.current, layout, minimal ? 'minimal' : 'full', now)}${variantOk ? '' : ' · no-variant'}`}
          </Text>
          {status ? (
            <Text variant="caption" tone="secondary" align="center" style={styles.diag} numberOfLines={2}>
              {status}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      {showDiag ? (
        <View style={styles.devRow}>
          <Pressable onPress={onStopMotion} accessibilityRole="button" accessibilityLabel="Stop motion now">
            <Text variant="caption" weight="600" style={styles.devChip}>
              [stop motion now]
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setDevSkipMotion(!skipNext);
              setSkipNext(!skipNext);
            }}
            accessibilityRole="button"
            accessibilityLabel="Skip motion on next sets"
          >
            <Text variant="caption" weight="600" style={styles.devChip}>
              {skipNext ? '[next sets: no motion ✓]' : '[next sets: no motion]'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="title2" align="center">
          Center your face
        </Text>
        <Text variant="subhead" align="center" style={styles.line} accessibilityLiveRegion="polite" numberOfLines={2}>
          {v.line}
        </Text>
        <ProgressBar progress={v.progress} fill={color.signal} style={styles.bar} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 380,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.separator,
    backgroundColor: '#0A0A0C',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brackets: { position: 'absolute' },
  pillLeft: { position: 'absolute', top: 14, left: 14 },
  pillRight: { position: 'absolute', top: 14, right: 14 },
  text: { alignItems: 'center', marginTop: 28 },
  line: { marginTop: 8, fontSize: 17, lineHeight: 24, maxWidth: 300 },
  bar: { width: 200, marginTop: 18 },
  diag: { marginTop: 6, fontSize: 11, lineHeight: 14 },
  devRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 6 },
  devChip: { fontSize: 11, lineHeight: 16, color: color.signal },
});
