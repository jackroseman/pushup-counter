/**
 * Public Supabase config, injected per EAS environment (development -> staging,
 * preview/production -> prod) as EXPO_PUBLIC_* variables. Both are safe to ship in the app.
 */
export interface BackendConfig {
  url: string;
  anonKey: string;
}

export function readBackendConfig(env: Record<string, string | undefined>): BackendConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return null;
  return { url, anonKey };
}

// EXPO_PUBLIC_* must be referenced literally so Metro inlines them at build time.
export const backendConfig = readBackendConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});
