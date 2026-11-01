/** Tiny event bus: "a set was saved", so the backup can run without the session code knowing about it. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onHistoryChanged(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function notifyHistoryChanged(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // a listener must never break saving a set
    }
  }
}
