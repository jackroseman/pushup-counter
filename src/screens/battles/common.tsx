import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useBackend } from '../../backend/BackendProvider';
import { useIdentity } from '../../backend/IdentityProvider';
import { Button } from '../../components/ui';
import { colors } from '../../theme';

/** Battles need an account with a username. Renders the reason + a fix when they're missing. */
export function AccountGate({
  children,
  onAccount,
  onProfile,
  why = 'Battles are played with friends, so you need an account.',
}: {
  children: React.ReactNode;
  onAccount: () => void;
  onProfile: () => void;
  why?: string;
}) {
  const { configured, session } = useBackend();
  const { profile, profileError } = useIdentity();
  if (!configured) return <Notice title="Not available" text="This build isn't connected to the battle server." />;
  if (!session)
    return (
      <Notice title="Sign in to battle" text={`${why} Solo sets keep working without one.`}>
        <Button title="Sign in" onPress={onAccount} />
      </Notice>
    );
  if (profile === undefined) {
    if (profileError) return <Notice title="Couldn't load your account" text={profileError} />;
    return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;
  }
  if (profile === null)
    return (
      <Notice title="Pick a username" text="Friends find you by your username.">
        <Button title="Pick a username" onPress={onProfile} />
      </Notice>
    );
  return <>{children}</>;
}

export function Notice({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.noticeTitle}>{title}</Text>
      {text ? <Text style={s.muted}>{text}</Text> : null}
      {children}
    </View>
  );
}

export function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
        <Text style={s.back}>‹ Back</Text>
      </Pressable>
      <Text style={s.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ minWidth: 60, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

export function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      style={[s.chip, on && s.chipOn, disabled && { opacity: 0.4 }]}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function SmallButton({ title, onPress, kind = 'primary' }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' }) {
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : colors.bg;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.small, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[s.smallText, kind === 'secondary' && { color: colors.text }]}>{title}</Text>
    </Pressable>
  );
}

export function Row({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const inner = <View style={[s.row, style]}>{children}</View>;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

export const s = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
  back: { color: colors.accent, fontSize: 17, minWidth: 60 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  noticeTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  text: { color: colors.text, fontSize: 16 },
  bold: { color: colors.text, fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14, marginTop: 8 },
  section: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.card, marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  chipTextOn: { color: '#111' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8 },
  small: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, marginLeft: 8 },
  smallText: { color: '#111', fontWeight: '700', fontSize: 14 },
  input: { backgroundColor: colors.card, color: colors.text, fontSize: 16, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
});
