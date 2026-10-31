import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AppSettings, DEFAULT_APP_SETTINGS, fetchAppSettings, SettingsSource } from './appSettings';
import { supabase } from './supabase';

export interface BackendState {
  configured: boolean;
  session: Session | null;
  appSettings: AppSettings;
}

const BackendContext = createContext<BackendState>({
  configured: false,
  session: null,
  appSettings: DEFAULT_APP_SETTINGS,
});

export function BackendProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    fetchAppSettings(supabase as unknown as SettingsSource).then((s) => alive && setAppSettings(s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <BackendContext.Provider value={{ configured: supabase !== null, session, appSettings }}>{children}</BackendContext.Provider>
  );
}

export const useBackend = () => useContext(BackendContext);
