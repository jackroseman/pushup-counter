import { useEffect, useState } from 'react';

/** The current time, read when the screen mounts and each time it comes back into view (keeps render pure). */
export function useFocusNow(navigation: { addListener: (event: 'focus', cb: () => void) => () => void }): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => navigation.addListener('focus', () => setNow(Date.now())), [navigation]);
  return now;
}
