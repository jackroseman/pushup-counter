import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { color } from '../ui/tokens';

/**
 * Safe-area frame per screen, replacing the old root SafeAreaView in App.tsx:
 * - `bare`: no header, no tab bar (set flow, summary, sheets): all edges.
 * - `header`: native header handles the top.
 * - `tab`: the tab bar handles the bottom (native tabs inset scroll views automatically).
 */
const EDGES: Record<'bare' | 'header' | 'tab', Edge[]> = {
  bare: ['top', 'bottom', 'left', 'right'],
  header: ['bottom', 'left', 'right'],
  tab: ['top', 'left', 'right'],
};

export function Frame({ kind, children }: { kind: keyof typeof EDGES; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.root} edges={EDGES[kind]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: color.bg } });
