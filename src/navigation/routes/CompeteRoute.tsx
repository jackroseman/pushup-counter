import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useBackend } from '../../backend/BackendProvider';
import { IconButton, Segmented, TabHeader, gutter } from '../../ui';
import { Frame } from '../frame';
import type { CompeteSegment, TabProps } from '../types';
import { ChallengesBody, LeagueBody } from './CompeteBodies';

const SEGMENTS = [
  { key: 'league', label: 'League' },
  { key: 'challenges', label: 'Challenges' },
] as const satisfies readonly { key: CompeteSegment; label: string }[];

/**
 * Compete tab: League + Challenges under one segmented control (frames 16, 18, 20).
 * The segment lives in the route params so `league` / `challenges` links pick it.
 * Signed out there is one sign-in body and no segments (frame 16).
 */
export function CompeteRoute({ navigation, route }: TabProps<'Compete'>) {
  const { session } = useBackend();
  const segment: CompeteSegment = route.params?.segment ?? 'league';
  const signedIn = !!session;
  return (
    <Frame kind="tab">
      <View style={styles.head}>
        <TabHeader
          title="Compete"
          right={
            signedIn ? (
              <>
                <IconButton icon="people" accessibilityLabel="Friends" onPress={() => navigation.navigate('Friends')} />
                <IconButton icon="plus" accessibilityLabel="New challenge" onPress={() => navigation.navigate('NewBattle')} />
              </>
            ) : null
          }
        />
        {signedIn ? <Segmented options={SEGMENTS} value={segment} onChange={(key) => navigation.setParams({ segment: key })} /> : null}
      </View>
      {/* Both bodies stay mounted so switching segments keeps their scroll and loaded data. */}
      <View style={[styles.body, signedIn && segment !== 'league' ? styles.hidden : null]}>
        <LeagueBody navigation={navigation} />
      </View>
      {signedIn ? (
        <View style={[styles.body, segment !== 'challenges' ? styles.hidden : null]}>
          <ChallengesBody navigation={navigation} />
        </View>
      ) : null}
    </Frame>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: gutter, gap: 12 },
  body: { flex: 1 },
  hidden: { display: 'none' },
});
