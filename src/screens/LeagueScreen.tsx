import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Button } from '../components/ui';
import { isAppleSignInAvailable, signInWithApple } from '../backend/auth';
import type { LeagueBoard, LeagueImprovementRow, LeagueTotalRow } from '../backend/leagueClient';
import { personName } from '../battles/model';
import { CROWN_CAPTION, LEAGUE_ABOUT, NO_FRIENDS, WEEK_LINE, formatCount, improvementDetail } from '../progress';
import { colors } from '../theme';

type Tab = 'Total' | 'Improvement';

/** Weekly board. Numbers come from the server. This screen does not recompute them. */
export function LeagueScreen({
  configured,
  signedIn,
  username,
  board,
  banner,
  meId,
  onBack,
  onAddFriend,
  onOpenFriend,
  onProfile,
}: {
  configured: boolean;
  signedIn: boolean;
  username: 'loading' | 'needed' | 'ready';
  board: LeagueBoard | null;
  banner: string | null;
  meId: string | null;
  onBack: () => void;
  onAddFriend: () => void;
  onOpenFriend: (row: LeagueTotalRow | LeagueImprovementRow) => void;
  onProfile: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Total');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (signedIn) return;
    isAppleSignInAvailable().then(setAppleAvailable);
  }, [signedIn]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>League</Text>

      {!configured ? <Text style={styles.body}>Sign in with Apple is not available in this build.</Text> : null}
      {configured && !signedIn ? (
        <>
          <Text style={styles.body}>{LEAGUE_ABOUT}</Text>
          {appleAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={12}
              style={styles.apple}
              onPress={async () => {
                setMessage(null);
                const result = await signInWithApple();
                if (!result.ok && !result.cancelled) setMessage(result.message ?? 'Sign-in failed.');
              }}
            />
          ) : (
            <Text style={styles.body}>Sign in with Apple is not available on this device.</Text>
          )}
          {message ? <Text style={styles.error}>{message}</Text> : null}
        </>
      ) : null}
      {configured && signedIn && username === 'loading' ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} /> : null}
      {configured && signedIn && username === 'needed' ? (
        <>
          <Text style={styles.body}>Friends find you by your username.</Text>
          <Button title="Pick a username" onPress={onProfile} />
        </>
      ) : null}
      {configured && signedIn && username === 'ready' ? (
        <Board tab={tab} onTab={setTab} board={board} banner={banner} meId={meId} onAddFriend={onAddFriend} onOpenFriend={onOpenFriend} />
      ) : null}
    </ScrollView>
  );
}

function Board({
  tab,
  onTab,
  board,
  banner,
  meId,
  onAddFriend,
  onOpenFriend,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  board: LeagueBoard | null;
  banner: string | null;
  meId: string | null;
  onAddFriend: () => void;
  onOpenFriend: (row: LeagueTotalRow | LeagueImprovementRow) => void;
}) {
  const rows = tab === 'Total' ? board?.total ?? [] : board?.improvement ?? [];
  const crowned = rows.some((row) => row.crownedLastWeek);
  return (
    <>
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <View style={styles.switch}>
        {(['Total', 'Improvement'] as const).map((name) => {
          const selected = name === tab;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onTab(name)}
              style={[styles.switchItem, selected && styles.switchOn]}
            >
              <Text style={[styles.switchLabel, selected && styles.switchLabelOn]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.week}>{WEEK_LINE}</Text>
      {crowned ? <Text style={styles.caption}>{CROWN_CAPTION}</Text> : null}
      {!board && !banner ? <Text style={styles.body}>Loading…</Text> : null}
      {rows.map((row) => (
        <Pressable
          key={row.userId}
          accessibilityRole="button"
          disabled={row.userId === meId}
          onPress={() => onOpenFriend(row)}
          style={({ pressed }) => [styles.row, pressed && row.userId !== meId && { opacity: 0.75 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {personName(row)}
              {row.crownedLastWeek ? ' 👑' : ''}
            </Text>
            {tab === 'Improvement' ? <Text style={styles.detail}>{improvementDetail(row as LeagueImprovementRow)}</Text> : null}
          </View>
          <View style={styles.score}>
            <Text style={styles.points}>{formatCount(tab === 'Total' ? row.reps : (row as LeagueImprovementRow).points)}</Text>
            <Text style={styles.rank}>{row.rank}</Text>
          </View>
        </Pressable>
      ))}
      {board && board.total.length < 2 ? <Text style={styles.body}>{NO_FRIENDS}</Text> : null}
      <Button title="Add a friend" kind="secondary" onPress={onAddFriend} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  header: { marginTop: 12 },
  back: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 8 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 22, marginTop: 16 },
  banner: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 12 },
  error: { color: colors.danger, fontSize: 15, marginTop: 8 },
  apple: { height: 48, width: '100%', marginTop: 16 },
  switch: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 4, marginTop: 16 },
  switchItem: { flex: 1, borderRadius: 9, paddingVertical: 8, alignItems: 'center' },
  switchOn: { backgroundColor: colors.accent },
  switchLabel: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  switchLabelOn: { color: '#111' },
  week: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 14 },
  caption: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginTop: 10 },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  score: { alignItems: 'flex-end', marginLeft: 12 },
  points: { color: colors.text, fontSize: 22, fontWeight: '800' },
  rank: { color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 2 },
});
