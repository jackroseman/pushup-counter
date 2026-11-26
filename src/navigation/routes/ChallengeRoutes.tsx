import React from 'react';

import { BattleScreen } from '../../screens/battles/BattleScreen';
import { NewBattleScreen } from '../../screens/battles/NewBattleScreen';
import { FriendsScreen } from '../../screens/battles/FriendsScreen';
import { FriendScreen } from '../../screens/battles/FriendScreen';
import { InviteScreen } from '../../screens/battles/InviteScreen';
import { useBackend } from '../../backend/BackendProvider';
import { useAppState } from '../appState';
import { Frame } from '../frame';
import { gate, openGoal } from './gate';
import type { Props } from '../types';

export function BattleRoute({ navigation, route }: Props<'Battle'>) {
  const { appSettings } = useBackend();
  const { enrollments } = useAppState();
  const d = appSettings.asyncBattleDefaults;
  return (
    <Frame kind="header">
    <BattleScreen
      {...gate(navigation)}
      battleId={route.params.challengeId}
      initialBattle={route.params.battle}
      share={route.params.share}
      justPlayed={route.params.justPlayed}
      promptAttempt={route.params.promptAttempt}
      promptNotifications={route.params.promptNotifications}
      hasGoal={openGoal(enrollments)}
      onNeedGoal={() => navigation.navigate('GoalSetup')}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Compete', params: { segment: 'challenges' } }))}
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
    </Frame>
  );
}

export function NewBattleRoute({ navigation, route }: Props<'NewBattle'>) {
  const { enrollments } = useAppState();
  return (
    <Frame kind="header">
    <NewBattleScreen
      {...gate(navigation)}
      friendIds={route.params?.friendIds}
      fromSet={route.params?.fromSet}
      offer={route.params?.offer}
      hasGoal={openGoal(enrollments)}
      onNeedGoal={() => navigation.navigate('GoalSetup')}
      onFriends={() => navigation.navigate('Friends')}
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
    </Frame>
  );
}

export function FriendsRoute({ navigation }: Props<'Friends'>) {
  return (
    <Frame kind="header">
    <FriendsScreen
      {...gate(navigation)}
      onOpenFriend={(friend) => navigation.navigate('Friend', { friend })}
    />
    </Frame>
  );
}

export function FriendRoute({ navigation, route }: Props<'Friend'>) {
  return (
    <Frame kind="header">
    <FriendScreen
      {...gate(navigation)}
      friend={route.params.friend}
      onChallenge={(f) => navigation.navigate('NewBattle', { friendIds: [f.userId] })}
      onOpenBattle={(challengeId) => navigation.navigate('Battle', { challengeId })}
    />
    </Frame>
  );
}

export function InviteRoute({ navigation, route }: Props<'Invite'>) {
  const { enrollments } = useAppState();
  return (
    <Frame kind="header">
    <InviteScreen
      {...gate(navigation)}
      token={route.params.token}
      hasGoal={openGoal(enrollments)}
      onNeedGoal={() => navigation.navigate('GoalSetup')}
      onJoined={(challengeId, promptNotifications) => navigation.replace('Battle', { challengeId, promptNotifications })}
    />
    </Frame>
  );
}
