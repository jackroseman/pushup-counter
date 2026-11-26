/** Tiny event bus: "a set was saved or deleted", so the backup can run without the session code knowing about it. */
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

const serverListeners = new Set<Listener>();

/** The backup's sets changed outside a set upload (a delete went through): server totals need a refresh. */
export function onServerSetsChanged(l: Listener): () => void {
  serverListeners.add(l);
  return () => serverListeners.delete(l);
}

export function notifyServerSetsChanged(): void {
  for (const l of [...serverListeners]) {
    try {
      l();
    } catch {
      // never break the sync loop
    }
  }
}
