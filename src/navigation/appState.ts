import { createContext, useContext } from 'react';

import type { Settings } from '../storage/settings';
import type { GoalEnrollment, NudgePrefs, ServerProgress, saveEnrollment } from '../progress';

export interface RemoteProgress {
  doc: ServerProgress | null;
  status: 'idle' | 'ready' | 'error';
}

export interface AppState {
  settings: Settings;
  updateSettings: (s: Settings) => void;
  nudges: NudgePrefs;
  updateNudges: (prefs: NudgePrefs) => void;
  savedSets: number;
  refreshSavedSets: () => void;
  enrollments: GoalEnrollment[];
  saveChoice: (choice: Parameters<typeof saveEnrollment>[1]) => Promise<void>;
  remote: RemoteProgress;
  lateIds: ReadonlySet<string>;
  refreshRemote: () => void;
  howToOpen: boolean;
  openHowTo: () => void;
  closeHowTo: () => void;
}

export const AppStateContext = createContext<AppState | null>(null);
export const useAppState = () => {
  const s = useContext(AppStateContext);
  if (!s) throw new Error('AppStateContext missing');
  return s;
};
