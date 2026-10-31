import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App variants, picked with the APP_VARIANT env var (set per build profile in eas.json and in
 * the matching EAS environment, so builds, fingerprints and updates all agree):
 *   development -> "Pushup Dev", com.jackroseman.pushupcounter.dev (dev client, installs side by side)
 *   anything else (preview / production / unset) -> the app.json values, unchanged
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!IS_DEV) return base;
  return {
    ...base,
    name: 'Pushup Dev',
    ios: { ...base.ios, bundleIdentifier: 'com.jackroseman.pushupcounter.dev' },
    android: { ...base.android, package: 'com.jackroseman.pushupcounter.dev' },
  };
};
