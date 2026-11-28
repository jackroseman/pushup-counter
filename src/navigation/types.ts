import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { SessionRecord } from '../storage/history';
import type { BattleSessionOptions } from '../session/useSession';
import type { Battle, Friend } from '../battles/model';
import type { ChallengeOffer } from '../battles/challengeFromSet';

export type CompeteSegment = 'league' | 'challenges';

export type TabParamList = {
  Today: undefined;
  Compete: { segment?: CompeteSegment } | undefined;
  You: { segment?: 'sets' | 'challenges' } | undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Welcome: undefined;
  GoalPick: undefined;
  HowItWorks: { onboarding?: boolean } | undefined;
  GoalSetup: undefined;
  Session: { battle?: BattleSessionOptions } | undefined;
  Summary: { record: SessionRecord; from: 'session' | 'history' };
  AllSets: undefined;
  Settings: undefined;
  DailyReminder: undefined;
  QuietHours: undefined;
  ProfileSetup: undefined;
  Battle: {
    challengeId: string;
    battle?: Battle;
    share?: boolean;
    justPlayed?: { reps: number; counted: number; phoneMoved?: boolean };
    promptAttempt?: boolean;
    /** Created, accepted, or joined this challenge on the way here. */
    promptNotifications?: boolean;
  };
  NewBattle: { friendIds?: string[]; fromSet?: SessionRecord; offer?: ChallengeOffer } | undefined;
  /** The league's (i) sheet: how Total and Improvement work. */
  LeagueInfo: undefined;
  Friends: { search?: boolean } | undefined;
  Friend: { friend: Friend };
  Invite: { token: string };
  /** Someone's personal invite link (pushupcounter://i/<code> or https://<web host>/i/<code>). */
  FriendInvite: { code: string };
  /** Your own invite link: Share, Copy, QR code, Reset. */
  InviteLink: undefined;
  InviteQr: { code: string };
};

export type Props<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
/** Tab screens get the same navigation API from the JS and the native tab navigator. */
export type TabProps<T extends keyof TabParamList> = CompositeScreenProps<BottomTabScreenProps<TabParamList, T>, NativeStackScreenProps<RootStackParamList>>;
