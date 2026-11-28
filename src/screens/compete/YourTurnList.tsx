import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { avatarName, formatStatusLine, waitingRows, type OpenChallenge } from '../../battles/openChallenges';
import { Avatar, Button, Card, ListGroup, ProgressBar, SectionHeader, Text, color, space } from '../../ui';

/** Shared Your turn / Waiting list used on Today and Compete. Layout only; section membership comes from the RPC. */
export function YourTurnList({
  rows,
  cap,
  seeAll,
  showWaiting = true,
  actionTitle = 'Your turn',
  onOpen,
  onRespond,
  onSeeAll,
  busyId,
}: {
  rows: readonly OpenChallenge[];
  /** When set, only the first N action rows are shown (Today). */
  cap?: number;
  seeAll?: boolean;
  showWaiting?: boolean;
  actionTitle?: string;
  onOpen: (challengeId: string) => void;
  onRespond?: (row: OpenChallenge, accept: boolean) => void;
  onSeeAll?: () => void;
  busyId?: string | null;
}) {
  const action = rows.filter((r) => r.isMyTurn);
  const shown = cap != null ? action.slice(0, cap) : action;
  const waiting = showWaiting ? waitingRows(rows) : [];
  if (shown.length === 0 && waiting.length === 0) return null;
  return (
    <>
      {shown.length > 0 ? (
        <>
          <SectionHeader title={actionTitle} action={seeAll && onSeeAll ? 'See all' : undefined} onAction={onSeeAll} />
          {shown.map((row, i) => (
            <ActionCard
              key={row.challengeId}
              row={row}
              first={i === 0}
              busy={busyId === row.challengeId}
              onOpen={onOpen}
              onRespond={onRespond}
            />
          ))}
        </>
      ) : null}
      {waiting.length > 0 ? (
        <>
          <SectionHeader title="Waiting" />
          <ListGroup>
            {waiting.map((row) => (
              <WaitingRow key={row.challengeId} row={row} onOpen={onOpen} />
            ))}
          </ListGroup>
        </>
      ) : null}
    </>
  );
}

function ActionCard({
  row,
  first,
  busy,
  onOpen,
  onRespond,
}: {
  row: OpenChallenge;
  first: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onRespond?: (row: OpenChallenge, accept: boolean) => void;
}) {
  const line = formatStatusLine(row);
  const play = row.ctaType === 'play';
  const start = row.ctaType === 'start_set';
  const invite = row.ctaType === 'accept_decline';
  return (
    <Card
      padding={0}
      style={first ? null : styles.nextCard}
      onPress={() => onOpen(row.challengeId)}
      accessibilityLabel={`${row.title}, ${line}`}
    >
      <View style={styles.cardInner}>
        <View style={styles.head}>
          <Avatar name={avatarName(row)} size={38} />
          <View style={styles.grow}>
            <Text variant="headline" style={styles.title} numberOfLines={1}>
              {row.title}
            </Text>
            {line ? (
              <Text variant="footnote" numberOfLines={1}>
                {line}
              </Text>
            ) : null}
          </View>
          {play || start ? (
            <Button title={row.ctaLabel ?? (play ? 'Play' : 'Start a set')} size="small" onPress={() => onOpen(row.challengeId)} />
          ) : null}
        </View>
        {row.progressFrac != null ? <ProgressBar progress={row.progressFrac} style={styles.bar} /> : null}
        {invite && onRespond ? (
          <View style={styles.answer}>
            <Button title="Decline" kind="gray" size="small" style={styles.flex} disabled={busy} onPress={() => onRespond(row, false)} />
            <Button title="Accept" size="small" style={styles.flex} loading={busy} onPress={() => onRespond(row, true)} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function WaitingRow({ row, onOpen }: { row: OpenChallenge; onOpen: (id: string) => void }) {
  const line = formatStatusLine(row);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${line}`}
      onPress={() => onOpen(row.challengeId)}
      style={({ pressed }) => [styles.waitRow, pressed && styles.pressed]}
    >
      <View style={styles.spread}>
        <Text variant="headline" style={[styles.title, styles.grow]} numberOfLines={1}>
          {row.title}
        </Text>
        <Text variant="footnote">{formatTimeLeftOnly(row)}</Text>
      </View>
      {line ? (
        <Text variant="footnote" style={styles.sub} numberOfLines={1}>
          {row.statusLabel}
        </Text>
      ) : null}
      {row.progressFrac != null ? <ProgressBar progress={row.progressFrac} style={styles.bar} /> : null}
    </Pressable>
  );
}

function formatTimeLeftOnly(row: OpenChallenge): string {
  if (row.awaitingResult) return '';
  const n = row.timeLeftAmount;
  const unit = row.timeLeftUnit;
  if (n == null || !unit || n <= 0) return '';
  if (unit === 'day') return n === 1 ? '1 day left' : `${n} days left`;
  if (unit === 'hour') return n === 1 ? '1 hour left' : `${n} hours left`;
  return n === 1 ? '1 minute left' : `${n} minutes left`;
}

const styles = StyleSheet.create({
  nextCard: { marginTop: space.xs },
  cardInner: { paddingVertical: space.sm, paddingHorizontal: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20 },
  answer: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  flex: { flex: 1 },
  bar: { marginTop: space.xs },
  waitRow: { paddingVertical: space.sm, paddingHorizontal: space.md },
  spread: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sub: { marginTop: 2 },
  pressed: { backgroundColor: color.fill.pressed },
});
