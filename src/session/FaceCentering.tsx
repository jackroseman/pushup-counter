import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FaceMeshView } from '../../modules/pushup-sensors';
import type { GuideSnapshot } from '../core';
import { faceMeshVariantSupported } from '../sensors';
import { Pill, ProgressBar, Text, color, radius } from '../ui';
import { faceCenteringView } from './sessionView';

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
  onFaceViewShown,
}: {
  guide: GuideSnapshot | null;
  flatCheck: boolean;
  /** Called once each time the face view is laid out on screen (the mesh needs tracking to start over). */
  onFaceViewShown?: () => void;
}) {
  const v = faceCenteringView(guide);
  const minimal = faceMeshVariantSupported();
  const shown = useRef(false);
  const onFaceLayout = () => {
    if (shown.current) return;
    shown.current = true;
    onFaceViewShown?.();
  };
  return (
    <View>
      <View style={styles.card}>
        <View style={StyleSheet.absoluteFill} onLayout={onFaceLayout} pointerEvents="none" testID="face-view">
          <FaceMeshView style={StyleSheet.absoluteFill} showAngles={false} {...(minimal ? { variant: 'minimal' as const } : null)} />
        </View>
        <Brackets ok={v.ready} />
        {flatCheck ? <Pill label="Phone flat" tone="signal" icon="check" style={styles.pillLeft} /> : null}
        <Pill label={v.centered ? 'Centered' : 'Not centered'} tone={v.centered ? 'signal' : 'neutral'} style={styles.pillRight} />
      </View>
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
});
