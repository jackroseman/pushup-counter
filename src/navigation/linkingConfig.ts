import { getStateFromPath as defaultGetStateFromPath, type LinkingOptions } from '@react-navigation/native';

import type { CompeteSegment, RootStackParamList } from './types';

type Linking = LinkingOptions<RootStackParamList>;
type Config = NonNullable<Linking['config']>;
type GetStateFromPath = NonNullable<Linking['getStateFromPath']>;

/** Every pre-rebrand path still works (§2 of the rebrand plan); `parseAppLink` is unchanged. */
export const linkingConfig: Config = {
  initialRouteName: 'Main',
  screens: {
    Main: {
      screens: {
        Today: {
          path: '',
          alias: ['today'],
        },
        You: 'progress',
      },
    },
    AllSets: 'history',
    Settings: 'account',
    Friends: 'friends',
    Battle: {
      path: 'challenge/:challengeId',
      alias: ['battle/:challengeId'],
    },
    Invite: 'invite/:token',
    FriendInvite: 'i/:code',
  },
};

/** Old tab paths that now open a Compete segment. */
const SEGMENT_PATHS: Record<string, CompeteSegment> = {
  league: 'league',
  challenges: 'challenges',
  battles: 'challenges',
};

/** Where Back goes when a link opens a screen on a cold start (matches the old in-screen fallbacks). */
const BACK_TO: Partial<Record<keyof RootStackParamList, RootStackParamList['Main']>> = {
  Battle: { screen: 'Compete', params: { segment: 'challenges' } },
  Friends: { screen: 'Compete', params: { segment: 'challenges' } },
};

const bare = (path: string) => path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');

export const getStateFromPath: GetStateFromPath = (path, options) => {
  const segment = SEGMENT_PATHS[bare(path)];
  if (segment) return { routes: [{ name: 'Main', state: { routes: [{ name: 'Compete', params: { segment } }] } }] };
  const state = defaultGetStateFromPath(path, options);
  const top = state?.routes[state.routes.length - 1];
  const back = top ? BACK_TO[top.name as keyof RootStackParamList] : undefined;
  if (!state || !back || state.routes.length !== 2 || state.routes[0].name !== 'Main' || state.routes[0].state) return state;
  return { ...state, routes: [{ ...state.routes[0], params: back }, state.routes[1]] };
};
