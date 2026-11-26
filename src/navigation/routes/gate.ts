/** Props for `AccountGate`: sign in (Settings) or pick a username. */
export const gate = (navigation: { navigate: (r: 'Settings' | 'ProfileSetup') => void }) => ({
  onAccount: () => navigation.navigate('Settings'),
  onProfile: () => navigation.navigate('ProfileSetup'),
});

/** True once this phone has an open daily goal. */
export function openGoal(enrollments: { endedOn: string | null }[]): boolean {
  return enrollments.some((row) => row.endedOn === null);
}
