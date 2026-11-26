import { colors } from '../theme';

/** Native header for pushed screens: small centered title, chevron-only back, swipe-back (frames 15, 26–29). */
export const header = (title: string) => ({
  headerShown: true,
  title,
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
});
