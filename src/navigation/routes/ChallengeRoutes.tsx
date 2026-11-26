import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { ChallengeScreen, type ChallengeMenuItem } from '../../screens/compete/ChallengeScreen';
import { CompeteGate } from '../../screens/compete/Gate';
import { LinkInviteScreen } from '../../screens/compete/LinkInviteScreen';
import { rematchParams } from '../../battles/challengeView';
import { IconButton } from '../../ui';
import { NewChallengeSheet } from '../../screens/compete/NewChallengeSheet';
import { shareInvite } from '../../battles/inviteFriends';
import { useIdentity } from '../../backend/IdentityProvider';
import { FriendsScreen, type FriendsScreenHandle } from '../../screens/compete/FriendsScreen';
import { FriendScreen, type FriendMenuItem } from '../../screens/compete/FriendScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import { gate, openGoal } from './gate';
import type { Props } from '../types';

function showMenu(items: { label: string; destructive?: boolean; onPress: () => void }[]) {
  if (Platform.OS === 'ios') {
    const cancelButtonIndex = items.length;
    const destructiveButtonIndex = items.findIndex((i) => i.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...items.map((i) => i.label), 'Close'], cancelButtonIndex, destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined },
      (index) => items[index]?.onPress(),
    );
    return;
  }
  Alert.alert('Challenge', undefined, [
    ...items.map((i) => ({ text: i.label, style: i.destructive ? ('destructive' as const) : ('default' as const), onPress: i.onPress })),
    { text: 'Close', style: 'cancel' as const },
  ]);
}

export function BattleRoute({ navigation, route }: Props<'Battle'>) {
  const { appSettings } = useBackend();
  const { enrollments } = useAppState();
  const d = appSettings.asyncBattleDefaults;
  const onHeader = useCallback(
    ({ title, menu }: { title: string; menu: ChallengeMenuItem[] }) =>
      navigation.setOptions({
        title,
        headerRight: menu.length ? () => <IconButton icon="ellipsis" accessibilityLabel="More" onPress={() => showMenu(menu)} /> : undefined,
      }),
    [navigation],
  );
  const onClosed = useCallback(
    () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Compete', params: { segment: 'challenges' } })),
    [navigation],
  );
  return (
    <Frame kind="header">
      <CompeteGate onProfile={() => navigation.navigate('ProfileSetup')}>
        <ChallengeScreen
          battleId={route.params.challengeId}
          initialBattle={route.params.battle}
          share={route.params.share}
          justPlayed={route.params.justPlayed}
          promptAttempt={route.params.promptAttempt}
          promptNotifications={route.params.promptNotifications}
          hasGoal={openGoal(enrollments)}
          onNeedGoal={() => navigation.navigate('GoalSetup')}
          onHeader={onHeader}
          onClosed={onClosed}
          onStartSet={() => navigation.navigate('Session')}
          onRematch={(b) => navigation.navigate('NewBattle', rematchParams(b))}
          onPlay={(b) =>
            navigation.navigate('Session', {
              battle: {
                battleId: b.id,
                format: b.durationS ? 'timed' : 'max_reps',
                durationS: b.durationS,
                idleEndS: d.maxRepsIdleEndS,
                capS: d.maxRepsCapS,
              },
            })
          }
        />
      </CompeteGate>
    </Frame>
  );
}

export function NewBattleRoute({ navigation, route }: Props<'NewBattle'>) {
  const { enrollments } = useAppState();
  const { profile } = useIdentity();
  return (
    <Frame kind="header">
      <CompeteGate onProfile={() => navigation.navigate('ProfileSetup')}>
        <NewChallengeSheet
          friendIds={route.params?.friendIds}
          fromSet={route.params?.fromSet}
          offer={route.params?.offer}
          hasGoal={openGoal(enrollments)}
          onNeedGoal={() => navigation.navigate('GoalSetup')}
          onInvite={() => profile && shareInvite(profile.username)}
          onCreated={(challengeId, share, extras) =>
            navigation.replace('Battle', {
              challengeId,
              share,
              promptAttempt: extras?.promptAttempt,
              justPlayed: extras?.justPlayed,
              promptNotifications: true,
            })
          }
        />
      </CompeteGate>
    </Frame>
  );
}

export function FriendsRoute({ navigation }: Props<'Friends'>) {
  const { profile } = useIdentity();
  const screen = useRef<FriendsScreenHandle>(null);
  useLayoutEffect(
    () =>
      navigation.setOptions({
        headerRight: () => <IconButton icon="plus" accessibilityLabel="Add a friend" onPress={() => screen.current?.focusSearch()} />,
      }),
    [navigation],
  );
  return (
    <Frame kind="header">
      <CompeteGate onProfile={() => navigation.navigate('ProfileSetup')}>
        <FriendsScreen
          ref={screen}
          onOpenFriend={(friend) => navigation.navigate('Friend', { friend })}
          onInvite={() => profile && shareInvite(profile.username)}
        />
      </CompeteGate>
    </Frame>
  );
}

export function FriendRoute({ navigation, route }: Props<'Friend'>) {
  const onHeader = useCallback(
    (menu: FriendMenuItem[]) =>
      navigation.setOptions({
        title: '',
        headerRight: () => <IconButton icon="ellipsis" accessibilityLabel="More" onPress={() => showMenu(menu)} />,
      }),
    [navigation],
  );
  return (
    <Frame kind="header">
      <CompeteGate onProfile={() => navigation.navigate('ProfileSetup')}>
        <FriendScreen
          friend={route.params.friend}
          onHeader={onHeader}
          onRemoved={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Friends'))}
          onChallenge={(f) => navigation.navigate('NewBattle', { friendIds: [f.userId] })}
          onOpenBattle={(challengeId) => navigation.navigate('Battle', { challengeId })}
        />
      </CompeteGate>
    </Frame>
  );
}

export function InviteRoute({ navigation, route }: Props<'Invite'>) {
  const { enrollments } = useAppState();
  useLayoutEffect(() => navigation.setOptions({ title: 'Invite' }), [navigation]);
  return (
    <Frame kind="header">
      <LinkInviteScreen
        {...gate(navigation)}
        token={route.params.token}
        hasGoal={openGoal(enrollments)}
        onNeedGoal={() => navigation.navigate('GoalSetup')}
        onJoined={(challengeId, promptNotifications) => navigation.replace('Battle', { challengeId, promptNotifications })}
      />
    </Frame>
  );
}
