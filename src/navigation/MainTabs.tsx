import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';

import { colors } from '../theme';
import { Icon, type IconName } from '../ui';
import { color } from '../ui/tokens';
import { nativeTabBar } from './tabs';
import type { TabParamList } from './types';
import { TodayRoute } from './routes/TodayRoute';
import { CompeteRoute } from './routes/CompeteRoute';
import { YouRoute } from './routes/YouRoute';

/** Today / Compete / You. sfSymbols on the native bar; the same glyphs as SVG on the JS bar. */
const TABS = [
  { name: 'Today', component: TodayRoute, sfSymbol: 'flame', icon: 'flame' },
  { name: 'Compete', component: CompeteRoute, sfSymbol: 'crown', icon: 'crown' },
  { name: 'You', component: YouRoute, sfSymbol: 'person.crop.circle', icon: 'person' },
] as const satisfies readonly { name: keyof TabParamList; component: React.ComponentType<never>; sfSymbol: string; icon: IconName }[];

// The native navigator throws when created off iOS, so only create the one in use.
const NativeTabs = nativeTabBar ? createNativeBottomTabNavigator<TabParamList>() : null;
const JsTabs = nativeTabBar ? null : createBottomTabNavigator<TabParamList>();

export function MainTabs() {
  if (NativeTabs) {
    return (
      <NativeTabs.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: color.label, tabBarInactiveTintColor: colors.muted }}>
        {TABS.map((t) => (
          <NativeTabs.Screen
            key={t.name}
            name={t.name}
            component={t.component as React.ComponentType}
            options={{ tabBarIcon: { type: 'sfSymbol', name: t.sfSymbol } }}
          />
        ))}
      </NativeTabs.Navigator>
    );
  }
  const Tabs = JsTabs!;
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: color.separator },
        tabBarActiveTintColor: color.label,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          component={t.component as React.ComponentType}
          options={{ tabBarIcon: ({ color: tint, size }) => <Icon name={t.icon} size={size} color={tint} /> }}
        />
      ))}
    </Tabs.Navigator>
  );
}
